# Web client coverage

What the web client (`/app/`) does of what FileMaker Pro does in Browse, Find
and Preview modes, and what it doesn't yet. Layout design is in
[design-mode.md](design-mode.md). Most-used gaps are listed first in each
table's "Missing" rows.

The client's own chrome (menus, toolbar, dialogs, the assistant, Dashboards,
Automations, Clean Up Data, the Script Debugger) follows
[design-guide.md](design-guide.md), in light and dark. Layouts always draw in
the file's own colors, whatever the system's dark mode setting.

## Clock and daylight saving time

Calculation timestamps count calendar seconds from January 1, 0001. Adding
seconds to a timestamp, or subtracting two timestamps, uses those wall-clock
values: two instants two minutes apart across New York's spring 2026 clock
change differ by 3,720 timestamp seconds; across the fall change they differ
by -3,480. Adding two minutes to `2026-03-08 01:59:00` gives `02:01:00`,
even though that local time does not occur. Use a UTC millisecond value when
an elapsed duration is needed. This follows [Claris's timestamp storage and
arithmetic description](https://help.claris.com/en/pro-help/content/timestamp-fields.html);
the exact DST examples have **not been verified in a FileMaker runtime**.

SQL `INTERVAL` arithmetic also keeps local timestamp components. In
`America/New_York`, `TIMESTAMPVAL('2026-03-08 01:59:00') + INTERVAL 2 MINUTE`
returns `2026-03-08 02:01:00`; the gap value stays as written. [Claris's SQL
reference](https://help.claris.com/en/sql-reference/content/functions-that-return-dates.html)
defines interval units but does not state DST gap behavior. This choice is an
inference from offset-free timestamp values, **not verified against FileMaker ExecuteSQL**.

Layout `{{CurrentDate}}` and `{{CurrentTime}}` symbols read the browser's clock
and time zone. Server-evaluated `Get ( CurrentDate )`, `Get ( CurrentTime )`,
and `Get ( CurrentTimestamp )` currently read the server's clock and time zone
unless the calculation host supplies a clock. A client and server on opposite
sides of midnight can therefore display different dates in one layout.
[Claris describes layout clock symbols as using the user's computer](https://help.claris.com/en/pro-help/content/inserting-variables-on-layout.html)
and [Get(CurrentTimestamp) as client-local in client/server sessions](https://help.claris.com/en/pro-help/content/get-currenttimestamp.html).
The precise WebDirect symbol clock and this split have **not been verified in a
FileMaker WebDirect runtime**. `Get ( CurrentHostTimestamp )` is the host-clock
function in [Claris's documentation](https://help.claris.com/en/pro-help/content/get-currenthosttimestamp.html).

✓ works · ◐ partly · ✗ missing

`npm run test:e2e` drives the web client in a real browser (packages/web/e2e):
opening a file, Find mode, editing, sorting, portals and record locking.

## Browser support and self-check

The automated browser tests in this repository run in Chromium through
Playwright. This verifies the tested flows in that Chromium environment; other
browser engines and specific browser release ranges have not been verified,
so no Firefox, Safari, Chrome or Edge version range is claimed here. Use a
current browser with JavaScript modules and `structuredClone` for the web
client.

Open `/app/self-check.html` to check browser features, local storage, the
server connection, and an approximate clock difference. The server version is not
public: Help > About shows it after sign-in. The
page reports unavailable features with a fallback or next step. Its Copy
results button includes only feature statuses, timing, server status,
and whether a browser session is present. It does not include session
tokens, file names, account names or the server address. If copying is blocked,
select and copy the displayed results manually.

Client-supplied found-set `ids` arrays accept at most 100,000 entries (including
duplicates); larger arrays receive HTTP 400. Refresh Window accepts the browser's
full found set so it can preserve display selection and order; its request body
is limited to 10 MB and its displayed-record response is capped at 200. Query-based
found sets can still span more records and are fetched in pages.

Data API requests using the same bearer token allow concurrent GETs and POST
`_find` calls, including their script options. Other Data API calls run one at a
time per token, in arrival order, including body reads and container uploads.
Up to 16 writes can wait per token for at most 30 seconds. A full queue or an
expired wait answers HTTP 503, message code 301, and `Retry-After: 1`;
disconnecting while waiting frees the slot. Reads neither acquire nor wait for
the gate. The web client also queues its own writes per token within the browser
runtime, including uploads and password changes, to avoid filling the server's
bounded queue during normal browser activity.

## Drawing layouts

| Feature | | Notes |
|---|---|---|
| Parts, theme styles, backgrounds, line spacing | ✓ | Header/footer/navigation parts, body alternate fill. |
| Fields: edit box, drop-down, pop-up, checkboxes, radio buttons | ✓ | Value lists, including related and second-field ones. |
| Field Inspector behavior (view-only, select-only, select on entry, Tab inserts tab) | ✓ | |
| Data formatting (number, date, time, timestamp) | ✓ | |
| Containers (images, files, Insert File) | ✓ | Pictures and PDFs show as thumbnails the server makes at the size drawn (sharp on high-density screens), video and sound play in place, other files show their type and name. Clicking or tapping a container (or Enter on it) offers Open Picture / Open PDF / Play Video (in a sheet over the window), Download (under the file's own name), Insert or Replace with Picture… or File…, Take Photo…, Signature… and Clear; dropping a file on it replaces the contents. A field set to store its files externally (open storage) gets new files in its folder under the file's container folder (RC_Data_FMS/<file>/<base>/<path>, as FileMaker Server keeps them, numbered when the name is taken); secure storage keeps them in the database. Portal rows' containers open and download, and take new files and Clear the same way, as long as the row is a saved related record (an empty last row has none yet) and the account may edit the field. A file of 8 MB or more goes up in pieces beside the other saving, with a progress bar and Cancel in a note at the bottom; if the connection drops it waits and goes on from where the server says it stopped (it gives up after several failures in a row), and the field changes only when the whole file is in. Cancelling, or an error, leaves the field as it was. |
| Device features, as FileMaker Go (beyond FileMaker Pro and WebDirect) | ✓ | Take Photo (the camera in the window, or the device's own camera or a picture), Signature (drawn with a finger, pen or mouse, saved as a PNG) and, in text fields, Insert > Bar Code… (QR codes and bar codes read by the camera where the browser can, which is Chrome and Edge on Android, ChromeOS and macOS; typing the code works everywhere) and Insert > Current Location. Scripts: Insert from Device [ field ; Type: Camera, Video Camera, Microphone, Photo Library, Music Library, Bar Code or Signature ] asks the person's device and waits, and Location ( accuracy ; timeout ) and LocationValues ask the browser (which asks the person the first time) once per run; refused or unknown, they give empty, as on FileMaker Go. Running without a person (schedules, the Data API) Insert from Device fails with error 3. |
| Merge fields and merge variables, {{PageNumber}}-style symbols | ✓ | Get ( PageNumber ) gives the page being printed when a script prints or saves records as PDF (in footer calculations, hide conditions and conditional formats too), and 0 otherwise. In Preview mode the {{PageNumber}} symbol shows each page's number, but formulas still get 0. |
| Buttons, button bars, icons | ✓ | One-step buttons run their step; scripts run on the server. |
| Tab controls, slide controls (dots, swipes) | ✓ | |
| Popovers (title bar, kept in the window, click outside closes) | ✓ | |
| Portals (sort, filter, initial row, scrolling, delete related row, add a related record) | ✓ | Typing in the empty last row adds a related record, its match fields filled in from the record on screen, as FileMaker does when the relationship allows creating records in the portal's table (one-step "=" relationships). A portal that doesn't scroll shows that row only when there's room under its rows. A scrolling portal shows all of the record's related records up to 2,000 (the record comes with 50; the page fetches the rest as soon as the layout is drawn); past 2,000 it stops there. The rest of what's typed in the row goes to the new record; only its own table's fields take typing there, and objects with hide conditions stay hidden. Revert Record deletes the related records it added. Accounts that can't create records in that table, and the offline copy, don't get the row. The server sends every repetition of a repeating field in a portal row or related field, and a write to one repetition leaves the others (tested in the store; not yet checked in a browser). | <!-- known-difference: Web client ;; A write to one repetition of a repeating field in a portal row or related field leaves the others (tested in the store), and has not been checked in a browser ;; Not seen in a browser yet ;; A browser test of the write -->
| Found-set portals (a portal on the layout's own table occurrence) | ✓ | As in FileMaker, the portal lists the window's found set in its current sort (the rows it shows are fetched first, the rest as they scroll into view), with the current record's row highlighted; clicking a row goes to that record. Its rows only show (the current record is changed in the layout's own fields), it has no row for new records, and Find mode gives it one request row as other portals. The Data API's portalData for it is the found set too: GET /records and _find list the records found, paged by the portal's offset and limit (without a limit, the rows Portal Setup shows and five more, worked out once for all the records of the page); a record read on its own lists itself, as FileMaker does. The web client reads the rows from POST /tabularius/app/v1/databases/{db}/layouts/{layout}/foundset. |
| Charts | ✓ | Column, bar, line, area, pie, scatter, bubble (plus stacked column/bar) render from decoded setup: type, source, series, titles and axis labels; axis ranges are supported. Binary setup positions remain hypotheses; unrecognized type or source codes leave a Chart placeholder. Legend visibility and position, gridlines, tick marks, point labels, color schemes and secondary axes have no verified binary decoding; the SVG uses its own automatic legend, ticks and colors, without the other options. Charts inside portals show a placeholder. Layout census reports unread setups as aggregate counts. |
| Web viewers | ◐ | Solution HTML (data: URLs) always works. An https address loads only when an administrator listed its host for the file (none are listed to begin with; see [Web viewers that load a web page](#web-viewers-that-load-a-web-page)); any other address shows as text. With Web Viewer Setup's "Allow JavaScript to perform FileMaker scripts" on, the page gets `FileMaker.PerformScript` and `FileMaker.PerformScriptWithOption` (a script of this file by name, the parameter as text, queued behind a script already running) and Tabularius's page API, below. |
| Hide object when, conditional formatting, tooltips, placeholders | ✓ | |
| Anchoring and sliding when the window resizes | ✓ | Anchors in Browse and Find, including inside groups, button bars, tab and slide panels and portal rows. A portal anchored top and bottom shows more rows as the window grows, as FileMaker does. Sliding in Preview and printing (below). |
| Drop-down calendar | ✓ | The browser's date picker, from the field or its icon; date and timestamp fields. |
| Auto-complete in edit boxes | ✓ | From the field's index: the first match fills in as you type, others in a list. Drop-down lists match their value list. |
| "Allow entry of other values" in checkboxes, radio buttons, pop-up menus | ✓ | The "Other…" item and its dialog; checkboxes keep values not in the list. |

## Browse mode

| Feature | | Notes |
|---|---|---|
| Form, List and Table View | ✓ | Table View column resize and reorder. List and Table View scroll through the whole found set: only the rows in view are drawn and records are fetched a page at a time as they come into view, so a million records scroll like fifty (measured: rows filled 30–50 ms after jumping to the middle of 1,000,000, steady 60 fps scrolling). A large sorted found set keeps its order on the server between pages, so only the first page pays for the sort. Lists with sub-summary parts still show 50 records at a time. |
| The window, as FileMaker Pro's | ✓ | The menu bar is FileMaker's: File, Edit, View, Insert, Format, Records (Requests in Find mode), Scripts, Tools, Window and Help, with FileMaker's item names and shortcuts (⌘B/⌘F/⌘L/⌘U modes, ⌘N, ⌘D, ⌘E, ⌘J, ⌘T, ⇧⌘T, ⌘R, ⌘S, ⌘=, ⇧⌘R, ⇧⌘S Script Workspace, ⇧⌘D Manage Database, ⌥⌘S Status Toolbar). The status toolbar is FileMaker's: the records navigator (book pages, record number, "N Total (Unsorted)" or "N Found (Sorted)"), Show All, New Record, Delete Record, Find, Sort and Quick Find, each an icon over its name; Find mode's has Requests, New Request, Delete Request, Perform Find, Cancel Find, Matching Records (Include/Omit), Insert: Operators and Saved Finds; Preview's has Pages (book pages and a page number box that follow scrolling), Exit Preview, Print and Save as PDF. The Layout pop-up shows the file's layout folders, a folder inside another labelled with its path, and its separators; File > Manage > Layouts… opens the layouts list in Design. Window > Show Window lists this file's windows in the browser (each New Window keeps its own found set) and brings the one picked forward, where the browser allows it. The layout bar under it has Layout, View As, Preview and Edit Layout. The foot of the window has zoom, the status toolbar's show/hide and the Browse/Find/Layout/Preview mode switch. Tabularius's extras stay out of the way: the Tools menu has Script Debugger, Data Viewer, Record Script, Ask AI, Dashboards, Automations and Clean Up Data; the layout bar's right end has Ask AI (the assistant's side panel) and a one-click Sort by. Log Out is in the File menu and at the foot of the window. |
| Find mode's Requests menu and the questions the window asks | ✓ | The Requests menu has Add New Request, Duplicate Request, Delete Request, Omit (⌘T, the same as the Omit button) and Go to Record/Request/Page (Next, Previous, Specify… for a request number). Omit and Specify… follow FileMaker's find-request and mode-shortcut pages (Command-T selects or deselects Omit; a shortcut moves to a specific find request). Delete All Requests and Revert Request are not offered: the FileMaker pages read for this guide don't name them as menu commands. Constrain, Extend and Find Matching Records that match nothing show the same "No records match this set of find requests" alert as Perform Find (Modify Find or Cancel). Delete Record, Delete All Records, Revert Record, Relookup, Replace All, Omit Multiple, Go to Record and naming a saved find or sort are asked in a dialog the page draws, not the browser's confirm and prompt boxes, which a browser can block without a word: Enter chooses the button on the right, Escape cancels. |
| Shortcuts in a browser tab | ✓ | Browsers keep ⌘/Ctrl+N, T and W (and with ⇧) for their own windows and tabs, so a page never sees them. In an ordinary tab the menus show New Record, Omit Record, Omit Multiple, Close and Insert User Name with Alt added (⌥⌘N, ⌥⌘T, ⌥⇧⌘T, ⌥⌘W, ⌥⇧⌘N; Ctrl+Alt+… elsewhere), and those keys work. In an installed app window the shortcuts are FileMaker's own. Not yet checked in each real browser: the browser tests run headless, which cannot press the keys a browser keeps for itself, so they check the Alt versions and the menus, not the reserved keys. | <!-- known-difference: Web client ;; The keys a browser keeps for itself (⌘/Ctrl+N, T, W) were not tried in each real browser: headless tests cannot press them ;; In an ordinary tab the Alt versions and the menus work ;; A manual check in each real browser -->
| Record navigation, record number box, found count | ✓ | |
| New, Duplicate, Delete, Omit, Show Omitted Only, Show All | ✓ | |
| Sort Records dialog, Unsort, sorted sub-summaries | ✓ | Each field sorts ascending, descending or in a custom order based on a value list (its values in order, then the rest), as in FileMaker; the Data API's sortOrder takes a value list's name too. |
| Quick Find | ✓ | |
| Open Quickly (⌘K, File menu) | ✓ | Finds layouts, scripts in the Scripts menu, menu commands, other hosted files (only on a server started with `--list-files-publicly`) and the client's own screens (Dashboards, Automations, Design…). Beyond FileMaker: it also finds saved and recent finds, saved sorts, the records last looked at (newest first, kept with the account), records of the layout whose fields hold the typed text (a few at a time, as Quick Find finds them; choosing one finds them all and shows that one), goes to a record by its number, and offers Quick Find on the typed text and asking the assistant. |
| Installable app and offline copy (beyond FileMaker) | ✓ | Install from the browser (Chrome/Edge: the install icon in the address bar; Safari: File > Add to Dock or Share > Add to Home Screen). Over HTTPS or on the same computer, the app's own files are kept, so it opens without a connection, and a banner says when you're offline. File > Offline Copy > Keep Offline Copy also keeps what this account opens in the file (layouts, found sets, records) in this browser, encrypted with a key made from the account's password. Without a connection, those can be read, even after closing the browser: the sign-in page then lists the files kept offline and opens them with the password. Changes to fields are kept and saved when the connection is back. If someone else changed the record meanwhile, or deleted it, a dialog shows yours beside theirs, with Keep Mine, Keep Theirs and Decide Later. Only changes to a record's own fields wait; new records, deletes, portal rows and scripts need the connection. Limits: a passkey or single sign-on sign-in can't start or open a copy, because the key comes from the password. After a password change, the copy moves to the new password: at once when the change is made while signing in, otherwise the next sign-in asks for the earlier password if changes are still waiting (or lets you discard them). A change sent with one still waiting for the same record goes with it, so it isn't mistaken for someone else's. Entries are named by an HMAC, so not even what was searched for can be read from the browser's storage; only the file and account names can. One window sends at a time. Pictures and container files aren't kept. The account's export privilege isn't checked (Tabularius doesn't model it yet). |
| Script triggers on layout, records, objects, panels, modes | ✓ | The file's OnWindowOpen runs when a window opens (the first, after OnFirstWindowOpen, and each Window > New Window) and its OnWindowClose when File > Close or logging out closes one; exiting False keeps the window (a browser tab closed with the browser's own button can't wait for a script). OnObjectValidate (exiting False keeps the cursor in the field) and OnObjectSave run when a changed field is left (for pop-ups, checkboxes and radio buttons, on each change). OnObjectKeystroke and OnLayoutKeystroke run for characters, Backspace, Delete, Tab, Return, Enter, Escape and the arrow keys typed in a field (Get ( TriggerKeystroke ) gives FileMaker's codes, such as Char ( 28 ) for the left arrow), each a trip to the server, so they slow fast typing. Home, End, Page Up and Page Down don't fire them: FileMaker's Code function lists no value for them (the keys it does list report its numbers: Backspace 8, Tab 9, keypad Enter 10, Return 13, Escape 27, arrows 28 to 31, Delete 127). |
| Menus: the file's custom menus, or FileMaker's standard menus | ✓ | Install Menu Set too. The Scripts menu lists the scripts marked "Include in menu", in their folders, that the account may run; only those can be run from it. Edit works on the field being edited; Paste reads the clipboard once the browser allows it, else ⌘V does. The Format menu is under Styled text below. |
| Keyboard: Tab order, ⌘ shortcuts, keypad Enter commits | ✓ | Beyond FileMaker: Open Quickly (⌘K) shows each command's shortcut, and ⌘/ (or "?" in Open Quickly) opens a sheet of every shortcut the window takes, the file's custom menus' included. |
| Styled text: the Format menu, TextColor, TextStyleAdd, TextFont, TextSize, GetAsCSS | ◐ | Browse mode's Format menu (Font, Size, Style with ⇧⌘P, ⇧⌘B, ⇧⌘I and ⇧⌘U, Text Color) formats the text selected in a text field. As in FileMaker, the formatting is kept with the data, so it shows in every layout and calculations see it (GetAsCSS ( Notes )). It shows in the field once it is left, and right after each command. Typing keeps it around what changed. A script, an import or a replace writes plain text, and so does another program changing the text. Calculations show their formatting too, and a stored one keeps it with the record when it is computed, on a write or after a design change (bold, italic, underlines, strikethrough, highlight, small caps, case, superscript and subscript, condense and extend). The formatting survives &, Left, Right and Middle, and TextStyleRemove, TextColorRemove, TextFontRemove, TextSizeRemove and TextFormatRemove take it off. GetAsCSS writes FileMaker's spans. Beyond FileMaker's Data API, a PATCH can carry "styles" beside "fieldData". The formatting shows in portal rows and related fields too, and the Format menu works in a portal row's own text fields (the related record keeps it; beyond FileMaker's Data API, a PATCH can carry "portalStyles" beside "portalData"). Typing in a portal row keeps it around what changed. The Format menu works in related fields outside portals too: the first related record keeps the formatting, as FileMaker writes the value there (a PATCH's "styles" can name "TO::Field"). Each repetition of a repeating text field keeps its own formatting: the Format menu works in any repetition, GetAsCSS ( Tags[2] ) sees it, and a PATCH's "styles" can name "Tags(2)" beside its value. Not yet: formatting in a related field's or portal row's repetitions past the first, in repeating stored calculations, and formatting read from the .fmp12 file. | <!-- known-difference: Web client ;; Formatting in a related field's or portal row's repetitions past the first, in repeating stored calculations, and formatting read from the .fmp12 file are not supported ;; That formatting is not shown or kept ;; Owner decision, and a sample file with such formatting -->
| Zoom, phone and touch screens | ✓ | As on FileMaker Go: on a phone the menu bar is one Menu button (its titles come down in two columns of 44-point targets, and a menu opens full width beneath them), and the records navigator (‹ record of found ›, New Record, Find; the requests and Perform Find in Find mode) sits in a bar at the bottom, in reach of a thumb; a sideways swipe in form view goes to the next or previous record (slide controls keep their own swipes); pulling down at the top of the window refreshes it (Records > Refresh Window), from the offline copy too. Scripts and layout formulas get the person's own Get ( Device ) (3 iPad, 4 iPhone, 5 Android), Get ( WindowWidth ), Get ( WindowHeight ), Get ( WindowContentWidth ), Get ( ScreenWidth ), Get ( ScreenScaleFactor ) and Get ( WindowOrientation ), so a solution's phone layouts and "hide when Get ( Device ) = 4" work; Get ( SystemPlatform ) is 4, as in WebDirect. Turning the device works out hide conditions again. |
| Live updates from other users, record locks, who else is here | ✓ | Beyond FileMaker: the toolbar shows round initials for the others who have the current record open, and "Being edited by …" (ringed) while someone holds its lock. List and table views mark every row someone else has open, so you can see where people are before you start typing. Closing a tab tells the others at once. Another user's change (in the web client, the Data API, MCP or a script) shows without a refresh, even while you type in another field of the same record: the rest of the layout updates and your typing stays. When they changed the very field you're typing in, nothing is overwritten: on leaving the field you see theirs and yours side by side, and keep theirs, keep yours or combine the two before saving. Your own other windows (Window > New Window) tell each other about edits over the browser, since the server counts them as the same session. If the connection to the server drops, the window retries with growing pauses, says "Reconnecting to the server" after a couple of failed tries, and reads the found set, the record and the locks again when it is back. A field edit that can't reach the server is tried twice more, then the field goes back to its stored value and a message says so. |
| Revert Record | ✓ | Fields save as each is left; reverting writes back what they held before this round of changes, and removes a new record not yet committed. | <!-- known-difference-ok: "not yet committed" describes a new record, not a difference from FileMaker -->
| Record History (Records menu) | Tabularius | Every create, edit and delete is logged automatically. The sheet lists a record's changes newest first: who, when, which surface it came from (web client, Data API, OData, an AI app, a script), each field's old and new value. **Put back** returns one field to its old value; **Delete this record** undoes a creation; **Bring this record back** undoes a delete, under its own id. A put-back is a change of its own, logged as a revert of that entry, and is limited to what the account could change by hand. Values the administrator told the log not to keep (and containers) can't be put back. |
| Replace Field Contents | ✓ | FileMaker's three choices: the value typed, serial numbers (the field's entry options or custom values, optionally updating the entry options) or a calculated result. A calculation needs full access, since it can read any field; beyond FileMaker, it can be tried on the current record first. Also beyond FileMaker, a replace in a field of the layout's own table (up to 50,000 records) can be undone from the toast that follows, or later from Clean Up Data's history; values changed again since are left alone. Also beyond FileMaker, with the assistant on: a fourth choice, "Replace with what AI writes from each record", takes an instruction in words ("the city from the address"), can be tried on the current record first, and works on up to 500 records of the found set in a field of the layout's own table. The model sees only the layout's fields the account can see, never password, key or token fields or containers, and nothing from a file with AI turned off; a record it can't tell is left as it is, and Undo puts the values back. |
| Delete Found Records / Delete All | ✓ | Asks first. Beyond FileMaker, the toast that follows (here and after Delete Record) offers Undo (up to 10,000 records, and only when no relationship deletes related records along with them, since those couldn't come back); Clean Up Data's history keeps it too. |
| Edit > Find/Replace (Find Again, Replace & Find Again) | ✓ | FileMaker's dialog: Find what, Replace with, Direction (Forward, Backward, All), Search across all records or the current one, Search within all fields or the current one, Match case, Match whole words only; Find Next, Replace & Find, Replace, Replace All. ⇧⌘F, ⌘G, ⇧⌘G. It looks in the edit boxes and drop-down lists showing (the front panel, not portals, pop-ups, checkboxes or radio buttons), and stays open beside the layout. Beyond FileMaker (WebDirect has no Find/Replace), Replace All can be undone from its toast when every field is the layout's own table's and the found set is at most 50,000 records. |
| Omit Multiple | ✓ | |
| Find Matching Records (context menu) | ✓ | Right-click a field: Find Matching Records, Constrain/Extend Found Set, Sort Ascending/Descending. Beyond FileMaker, with the assistant on: Explain This Value asks it why the field shows what it does. With AI off, Explain This Value opens the server's own trace instead: the field's formula, every value it read, whether a stored calculation is out of date, and the calculations behind it; for a related field or portal row, the relationship followed and why that record is there. It reads the field's formula and every value the formula used, or the relationship a related field follows. Accounts that can't see the file's design get the assistant's refusal. The item isn't offered for a file with AI turned off. |
| Relookup Field Contents | ✓ | Records menu, on the field the cursor was in, after asking, for the whole found set. |
| Import / Export Records, Save as Excel or PDF | ✓ | File > Import Records… adds a picked CSV, tab-separated, merge (.mer, its first record naming the fields), Excel or FileMaker XML file's rows as new records (columns matched to fields by name or order; the new records become the found set). Text saved as UTF-8, UTF-16 or Windows-1252 is read as such, a .csv with semicolons or pipes comes in as columns, a quote that is never closed is reported with its row, an Excel workbook with several sheets offers a Worksheet choice (the first is read until another is picked), and a leading apostrophe an export put before a negative number or a formula-like value is taken off for number and date fields. File > Export Records… and Save Records as Excel… download the found set with the fields picked, as FileMaker's export types: CSV, tab-separated, merge (field names first), .xlsx (dates, times and timestamps as Excel date cells; with field names, a bold frozen header row with filter buttons), FileMaker XML (dates as ISO text, as the format says) or an HTML table. Comma- and tab-separated text puts an apostrophe before a text value a spreadsheet would take for a formula (not before a number or date field's value, whose minus sign is only a sign), and "UTF-8 with byte order mark" (off by default) starts a text file with the mark Excel on Windows needs to read accents. Both follow the account's record and field privileges, and need the privilege set's "Allow exporting" (without it, Export Records, Save Records as Excel and the other export steps are refused with error 9, insufficient privileges). Import has FileMaker's three actions: add new records, update matching records in the found set (on the match fields picked: every matching record, the last matching row winning, a blank in the file overwriting) or replace data in the found set (its records in order, one row each), with "Add remaining data as new records". Beyond FileMaker, where Update and Replace can't be undone, Undo in the toast that follows (or Clean Up Data's history) puts back what the fields held, for up to 50,000 records. A file larger than 50 MB is refused before it is sent, with a message to split it and import the parts one after another. File > Import Calendar (.ics)… reads an iCalendar file into a date or timestamp field (one record per event); File > Manage > Calendar Feeds… (Full Access only) makes, lists and revokes calendar links, with each address shown once: see [Calendar feeds](calendar-feeds.md). File > Import Tables… (Full Access only) makes whole tables from CSV, Excel or Notion files exported from another tool, with a preview of each table's fields and column types that can be changed before anything is made: see [Moving in from other tools](moving-in-from-other-tools.md). |
| Insert menu (Current Date, Time, User Name, From Index, From Last Visited) | ✓ | With FileMaker's shortcuts; User Name is the account name. |
| Edit menu: Undo, Redo, Cut, Copy, Paste, Clear, Select All | ✓ | On the field being edited, using the browser's own undo. Copy (or ⌘C) with no field active copies the record's fields on the layout, separated by tabs, as FileMaker does. Copy and Cut in scripts reach the person's clipboard too. Spelling is not done. |
| New Window / several windows | ✓ | Window > New Window opens a browser window on the same session, found set and record; Close in it just closes it. A change in one is shown in the others without a reload. |
| Windows a script opens (New Window's window styles) | ◐ | A script's New Window opens in the same browser window. A card is drawn over the window it opened from: the window behind is dimmed and waits, toolbar included. Its close control or Escape (outside a field) closes the card, and so does Close Window in a script, the button's or a later one's. The window behind then comes back with its layout, found set and record. A document window takes the whole area, and Window > Show Window switches between the windows a script opened. Floating windows and dialogs draw like cards without the dimming. The size and place come from New Window's options, or else the layout's size, never past the edges. Runs send the window they start in and the windows open, and the result says which window the script ended in and which it closed (`window`, `closed`). Not yet: dragging or resizing these windows, and a separate browser window for a script's document window. | <!-- known-difference: Web client ;; Dragging or resizing a script's windows and a separate browser window for a script's document window are not supported ;; Windows open as cards over the page ;; Owner decision -->

## Find mode

| Feature | | Notes |
|---|---|---|
| Find requests in fields and portals, Perform Find | ✓ | Return in a field performs the find. A find that matches nothing shows FileMaker's alert: Modify Find goes back to the requests, Cancel to the found set from before. (The browser's console still logs the Data API's own HTTP 500 with code 401 for it, as FileMaker's API does.) |
| Several requests: New, Duplicate, Delete, move between them | ✓ | ⌘N, ⌘D, ⌘E, ⌘↑/⌘↓. |
| Omit requests, omit-only finds | ✓ | |
| Modify Last Find | ✓ | ⌘R. |
| Find operators (=, ==, <, ..., !, //, ?, @, *, #, ~, "") | ✓ | Typed; done by the server. |
| Text finds ignore case and accents | ✓ | In every script, as FileMaker's English index does (`zurich`, `ZÜRICH` and `Zürich` are one word). A letter with no accent to take off (ł, ø, ß) matches its plain form in a whole-field (`==`) or wildcard find, and when typed as itself; a plain word find does not yet cross that gap. Unique validation ignores case in every script but keeps accents apart. | <!-- known-difference: Web client ;; A plain word find does not yet match a letter with no accent to take off (ł, ø, ß) to its plain form, though a whole-field or wildcard find does ;; A word find for the plain spelling misses words written with those letters ;; A FileMaker run of a word find on those letters -->
| Find with AI (a find described in words) | ✓ | Not in FileMaker. In Find mode's toolbar, and from Open Quickly (⌘K) in Browse or Find mode: type the find in words and pick "Find with AI". The assistant sees only the layout's design and fills in the requests to check before Perform Find. Not offered for files with AI off. |
| Constrain / Extend Found Set | ✓ | Done by the server's script engine, as the steps are. |
| Saved Finds and recent finds | ✓ | Records > Saved Finds: the last ten finds, saved finds, Save Current Find, Edit Saved Finds. Kept on the server with the account, as FileMaker keeps them with the user, so they follow it to any browser (with a copy in the browser for offline; what a browser kept before moves up once). Beyond FileMaker: Records > Saved Sorts names and keeps sort orders the same way. API tokens limited to reading or to some layouts can't see or change them. Saved finds, saved sorts and recent records from two windows (or browsers) are merged by name when sent, so one doesn't overwrite what the other added; one removed here stays removed. |
| Insert Operators menu | ✓ | Requests > Insert Operator and the Operators list in the Find mode toolbar. |

## Preview mode and printing

| Feature | | Notes |
|---|---|---|
| Pages from the file's page setup (paper, orientation, margins, scale) | ◐ | Paper, orientation and margins come from the file. Page Setup scale (the file's PMScaling) is applied in web Preview and browser printing only: a scale below 100% enlarges the layout area in inverse proportion and shrinks it onto the same sheet. That behaviour is inferred from Claris's description of Scale and the saved print settings, not checked against FileMaker. Save Records as PDF ignores the scale and prints at 100%. Layout Setup's Use fixed page margins replaces the file's margins in web Preview, browser printing and Save Records as PDF; ticking it starts from the file's margins. Without a page setup (Windows files), a layout as wide as a sheet of A4 or Letter prints to that sheet edge to edge (inferred); others get Letter with half-inch margins, landscape when wide. | <!-- known-difference: Web client ;; Page Setup scale (a scale below 100% enlarges the layout area in inverse proportion and shrinks it onto the sheet) is inferred from Claris's description, not checked against FileMaker; Save Records as PDF ignores the scale ;; Preview and browser printing may lay out a scaled page differently ;; A FileMaker print of a layout with a scale -->
| Headers, footers, title header/footer, sub-summaries, page breaks | ✓ | |
| Page numbers, "hide when printing" objects | ✓ | Both the `{{PageNumber}}` symbol and the numeric form newer files store (`{{1015}}`, inferred). | <!-- known-difference: Web client ;; The numeric form newer files store for the page number symbol ({{1015}}) is inferred ;; A page number may not show for a layout that stores it so ;; A sample file with that symbol -->
| Print (browser print) | ◐ | An account whose privilege set doesn't allow printing gets no Print or Save Records as PDF command (menu, ⌘P or toolbar), and one that doesn't allow exporting gets no Export Records or Save Records as Excel. The server refuses Save Records as PDF and the exports for that account too; Print itself is the browser's, so the browser's own File > Print can still print the page. A script set to run with full access can still print. Preview can render at most 500 found records; printing a larger found set from a menu, ⌘P or the toolbar asks first: OK runs Save Records as PDF for the complete set, Cancel prints nothing. A script's Print step doesn't ask and prints the first 500. |
| Sliding objects and parts up/left | ◐ | Fields and texts set to slide shrink to their content (empty ones to nothing) and objects below or to the right close up; the part shrinks when an object asks. A portal set to slide up and shrink its part leaves out its empty rows, and portals print only the rows they show, from the initial row. Groups and objects inside panels don't slide. A sliding part that shows the page number shows its own page's. |
| Columns (Layout Setup > Printing) | ✓ | Set in design mode's Layout Setup (Printing: columns, across or down first). Preview mode and Save Records as PDF put records' body and sub-summary parts side by side, each column the printable width divided by the count; grand summaries run across the page (inferred). What lies beyond the first column's width isn't printed. Not read from converted .fmp12 files yet (no sample sets it). | <!-- known-difference: Web client ;; Grand summaries run across the page in columns (inferred), what lies beyond the first column's width is not printed, and column settings are not read from converted .fmp12 files (no sample sets it) ;; A converted layout prints in one column ;; A sample file with columns set, and a FileMaker print -->
| Save as PDF | ✓ | File > Save Records as PDF… makes the PDF on the server (the records being browsed or the current record, as the layout prints) and downloads it; the browser's print dialog can save one too. The server's PDF pages follow Preview in paper and margins (fixed page margins included), Part Definition page breaks, page numbers that start again, "hide when printing" and sliding. They don't follow Page Setup scale: the PDF prints at 100% where Preview scales. |
| Files scripts save (Export Records, Save Records as Excel or PDF, Close PDF, Export Field Contents) | ✓ | Download to the browser, as in WebDirect, instead of landing in the server's documents folder; the path the step names gives the file name (else Untitled.pdf and so on). Up to 50 MB. |

## Links from other pages and systems

A link in WebDirect's form opens the web client on a file, and can run a script there:

```
https://<host>/fmi/webd/<file>[?script=<script name>[&param=<text>][&$name=<value>…]]
```

The person signs in as usual, the file opens, and then the script runs: `param` is its script parameter and each
`$name=value` is a local variable it starts with (up to 20; a name with `$$` is ignored). The script runs only for an account
whose privilege set has the `fmurlscript` extended privilege (the person is told otherwise), and as that account, so the
script privileges apply. Spaces and special characters in a name or value are written as `%20` and so on. The script is
taken out of the address once it has run, so a reload doesn't run it again. Left out: the `homeurl` sign-out redirect (the
Claris page doesn't document it), and a script link kept through Sign in with an identity provider (the provider's page
returns to `/app/` without it).

### Address, browser history and page title

The `/app/` address carries the selected file, layout, record ID, browse/find/preview mode,
layout view, and found/total counts. File and layout names are URL-encoded. Record field values,
find criteria and credentials are not written to the address. A shared address is still checked
against the signed-in account: if it names a layout that account cannot open, the client says
the link is unavailable; if the record has since gone, it says so. Back and Forward restore
record, view and mode changes. Not done: the found set itself is not in the address, only its size. Back to a screen that showed every record shows every record again; Back to an earlier found set of fewer records keeps the set on screen (the entry is left as it was), and Back to a record that has since been deleted says so. The default page title is `file - layout - record`; the optional
`tabularius.titlePattern` browser setting accepts `{file}`, `{layout}` and `{record}` placeholders.

Upgrade note: the browser tab now shows `file - layout - record` (a window opened with New Window keeps its number at the end), where it used to show only the file name. The address now holds the file name, layout name and record ID, so a copied address shows them. Each change of record, layout, view or mode adds a Back entry, except moves a script makes, which replace the address. Window names that scripts and the Window menu use do not change.

## Web viewer pages (modern layouts)

Design > Layouts' New layout makes a classic layout or a modern one: a page in HTML, CSS and JavaScript in a web viewer
that fills the window. Its page is kept in the web viewer's address formula
(`"data:text/html;base64," & Base64EncodeRFC ( 4648 ; "…" )`), so FileMaker Pro and FileMaker Go open the same
layout and show the same page. Layout mode's Edit page… (in the layout bar, or the Inspector's Data tab for any web
viewer whose address is such a page or empty) edits it beside a preview, as one undoable step that Save keeps.
FileMaker Pro takes formulas of up to 30,000 characters; the editor says how much of that a page uses.

New layout also offers **Modern dashboard**: a page worked out from the table's field names and types (no records are read to build it): tiles for the record count and the total and average of the likeliest number field (a name like Total, Amount, Price), a chart of it by the likeliest category field (Status, Region, Type…) with a donut of each group's share (click a bar or a legend row to narrow every figure to that group, click it again or Clear to undo), a chart by month of the first date field, a Period picker (this month, last 30 days, year to date…) that narrows the figures and charts by the date field and shows how the record count and total moved from the period before, and the latest records (and, when the table has a container field, a gallery of its latest pictures). It reads live as the signed-in account, a part the account may not see shows its own error while the rest draws, and it is plain HTML you can edit with Edit page….

The same page comes in three solution **templates**, each adding the figures that kind of file asks for, picked from the table's fields (and suggested by the table's name: Invoices, Products, Contacts…): **CRM** adds *New this month* (records whose first date field falls in this month); **Inventory** adds *Low stock* and *Out of stock* from the quantity field (a name like Qty, Quantity, Stock, On Hand), with the low-stock line, 10, as `LOW_STOCK` at the top of the script; **Invoicing** adds *Outstanding* and *Paid* totals read from the status groups (a status that reads paid, closed, complete or settled is paid; cancelled, void, draft and refund count for neither). A template whose fields the table lacks falls back to the general dashboard. They are plain page code like the rest, so Edit page… changes any figure.

Design > Layouts > File options has **Make a landing page for each privilege set…**: a modern layout "Home - <set>" per
set, each in a colour of its own, that greets the signed-in account by name and shows a card for each layout that
account may open (so each set sees only what it can use). It also adds the script "Go to my home page", which goes to
the page named for `Get ( AccountPrivilegeSetName )`, and sets it as the file's OnFirstWindowOpen script unless the file
already has one (then call the script from yours). Pages and script that are already there are left alone; edit a page
with Edit page… or ask the assistant to make it your own. For a page's own use, `tabularius.layouts()` lists the layouts the
account may open, `tabularius.goToLayout(name)` goes to one, and `tabularius.context()` includes the account's name.

The assistant writes these pages too: ask it for a dashboard, a landing page or a home screen ("an animated sales
dashboard for managers"), or use Describe a change to this page… in the page editor. It writes the page against the
file's real layouts and fields, and shows it, live, with Apply; nothing changes until it is applied, and Undo takes
it back. Its pages keep everything inline (no network), check for `window.tabularius` so they still say something in
FileMaker Pro, and turn animation off for people who ask their system for reduced motion.

A web viewer whose page is HTML, CSS and JavaScript can be a whole layout: a dashboard, a landing page, a record
screen. With Web Viewer Setup's "Allow JavaScript to perform FileMaker scripts" on, the page can call, as the
signed-in account (the server's privilege checks apply to every call):

| Call | Returns |
| --- | --- |
| `tabularius.context()` | `{file, account, layout, mode, recordId, recordNumber, foundCount, totalCount, fieldData}` of the window |
| `tabularius.layouts()` | the names of the layouts this account may open |
| `tabularius.goToLayout(name)` | goes to one of them |
| `tabularius.records(layout, {offset, limit, sort})` | `{data, foundCount, totalCount}`; `limit` up to 1000 (default 100) |
| `tabularius.find(layout, requests, {offset, limit, sort})` | the same, for find requests such as `[{"Status": "Open"}]` |
| `tabularius.record(layout, recordId)` | one record |
| `tabularius.create(layout, fieldData)` | `{recordId}` |
| `tabularius.update(layout, recordId, fieldData)` | `{modId}` |
| `tabularius.remove(layout, recordId)` | `{deleted: true}` |
| `tabularius.image(link, size)` | a container link made a thumbnail link, `size` pixels at most (16 to 1024); `''` for anything that isn't a container link |
| `tabularius.print()` | the browser's print dialog for the window (the page alone), where a dashboard is saved as PDF; refused for an account that may not print |
| `tabularius.summarize(widget)` | a dashboard widget's figures (a chart, table or number, as `/tabularius/dashboards/v1` takes them) |
| `tabularius.valueList(name)` | a value list as this account may use it: `{values, labels?}` (`labels` is the text to show when it differs from the value stored); a list of related values is empty, since it needs a record; refused for a list the account can't use |
| `tabularius.performScript(name, parameter)` | runs a script, as `FileMaker.PerformScript` does |
| `tabularius.on('refresh', fn)` | `fn` runs whenever the window is drawn again (another record, a script, a save) |

The page editor's **Page API tour** steps through these calls (who and where, reading, finding, writing, figures, pictures, moving
around, scripts, staying current, and working in FileMaker Pro too), each with a snippet that Add to page puts at the end
of the page's script, written for the layout being edited.

A container field comes back as a link to its file, and a page may show it in a `img` (or as a CSS image): the page's
image policy allows data images and this server's container links, which are signed, expire after an hour
(`TABULARIUS_CONTAINER_TTL`), stop working if the account they were made for is blocked or removed, and are only given for fields the signed-in account may read. The links are written with the
address the window was opened from. Nothing else loads: images from any other address stay blocked, and so do video
and audio.

Each call returns a promise; a refused call rejects with the server's message. The page still runs in a sandbox with
no network, cookies or access to the app. FileMaker Pro shows the same layout in its own web viewer, where
`FileMaker.PerformScript` works as well; `window.tabularius` is Tabularius's, so a page that should also work in FileMaker
Pro checks for it.

## Web viewers that load a web page

A web viewer whose address is a page made in the file (a `data:` address) always works. An `https://` address loads only
when an administrator has listed its host for that file, in the admin console under Hosted files, **Web viewers may
load**. The list is empty for every file to begin with, including a new or converted one and the demo, so an address on
the web shows as text that names the host to allow.

- A host is a name like `maps.example.com`, or `*.example.com` for any subdomain (not `example.com` itself). Write
  just the name: no `https://`, port, path or sign-in. Addresses on a local network, numbers and single-word names are
  refused, and so is a list of more than 50.
- A listed page loads over **https only**, on the default port, with no sign-in in the address; `http://` never loads.
- It runs in a frame of its own origin, in a sandbox: it cannot reach the app, its cookies or the session, cannot open
  windows or take the window over, and is told nothing about it. It gets none of the page API above (no
  `FileMaker.PerformScript`, no `window.tabularius`), Perform JavaScript in Web Viewer sends it nothing, and the
  viewer's Go Back and Go Forward only follow the addresses the layout sets, not links the person follows inside it.
- The list is per file, and the app's page allows framing every listed host of any file; the web client frames only
  the hosts of the file it is showing. After the list changes, people need to reload the page.
- The host sees the address of whoever opens the page (the page is fetched by their browser, with no referrer), and
  can show them anything, including something that looks like the app. List only sites you trust. A change is
  recorded in the file's security log (Web viewer hosts), with what was allowed and removed.
- A host name on the list says nothing about what is on its pages: allowing `*.example.com` allows every site under it,
  and a name that is a public suffix (such as `*.co.uk`) would allow far more than you mean to.
  The console refuses the address of the server itself (set the server's public address, `--public-url`, so it knows it), since a page of it would run beside the app. The app page's policy names at most 200 hosts across all files.

<!-- known-difference: Web client ;; A web viewer loads an https address only when an administrator listed its host for the file, over https only; FileMaker loads any address, and Go Back, Go Forward and Perform JavaScript in Web Viewer do not work on a page from a web host ;; An address on the web shows as text naming the host, until it is listed ;; Owner decision -->
