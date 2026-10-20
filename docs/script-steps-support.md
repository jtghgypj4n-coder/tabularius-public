# Script steps the engine does not fully run

This page describes behavior in Tabularius's server script engine. “Error 3” is
the engine's unavailable-step error. The script runner records the error and
normally continues with the next step. A step marked “does nothing” returns
success without carrying out its action. “Partly supported” means the handler
runs but omits the listed behavior or options.

## Not supported (error 3)

| Script step | What happens |
|---|---|
| New File; Convert File; Recover File; Save a Copy as Add-on Package | No dispatch handlers; each reaches the error 3 fallback. <!-- engine.ts --> |
| Trigger Claris Connect Flow | No dispatch handler; reaches the error 3 fallback. <!-- engine.ts --> |
| AVPlayer Play; AVPlayer Set Playback State; AVPlayer Set Options | No dispatch handlers; each reaches the error 3 fallback. <!-- engine.ts --> |
| Configure Region Monitor Script; Configure Local Notification; Configure NFC Reading | No dispatch handlers; each reaches the error 3 fallback. <!-- engine.ts --> |
| Check Selection; Check Record; Check Found Set; Correct Word; Spelling Options; Select Dictionaries | No dispatch handlers; each reaches the error 3 fallback. <!-- engine.ts --> |
| Fine-Tune Model; Configure Regression Model | No dispatch handlers; each reaches the error 3 fallback. <!-- engine.ts --> |
| Send DDE Execute; Speak | No dispatch handlers; each reaches the error 3 fallback (Windows-only and text-to-speech steps). <!-- engine.ts --> |
| Insert Image Caption; Insert Image Captions in Found Set | No dispatch handlers; each reaches the error 3 fallback. <!-- engine.ts --> |

| Send Mail (via SMTP Server on a server not set up to send; via E-mail Client with no person's browser) | Error 3: Tabularius sends no email unless the administrator switches sending on (see Partly supported). Outbound test mode captures a test message separately. <!-- engine.ts case 63 --> |
| Execute SQL | Explicitly throws error 3 because external ODBC sources are unavailable. The ExecuteSQL calculation function is separate. <!-- engine.ts --> |
| Perform AppleScript | Explicitly throws error 3. <!-- engine.ts --> |
| Get Folder Path | Explicitly throws error 3. <!-- engine.ts --> |
| Send Event | Explicitly unavailable on FileMaker Server; reaches the error 3 fallback. <!-- engine.ts; Claris Send Event compatibility --> |
| Configure Machine Learning Model | Explicitly throws error 3. <!-- engine.ts --> |
| Configure RAG Account; Perform RAG Action | Work on the server's own RAG spaces, which need the embedding model (`--ai-embed-url`, `--ai-embed-model`); without it, or offline, error 3. Configure RAG Account only names the account: its endpoint and key are never read. A space belongs to the file whose script made it, and the file's AI switch, personal data isolation and the account's AI privilege apply. **Add Data** takes text (From Text) or a PDF or text container (From Container; the async variants run the same way); From File reads a PDF or text file from the server's documents folder only (up to 50 MB; a path outside it is error 100). Tokens per Text Chunk accepts 75 to 512, uses the server default when omitted or 0, and returns error 887 outside that range (Claris). **Send Prompt** embeds the prompt and takes the closest chunks. Claris documents `similarity_threshold` as -1 to 1 and `num_top_ranked_results` as 1 to 100, with 0 explicitly meaning no RAG context; behavior for out-of-range search values isn't documented, so this engine keeps its existing clamps (`similarity_threshold` to -1..1 and result count to 0..100). The default result count is 5 and default threshold 0. The engine also supports `keyword_weight` (0 to 1, default 0), which blends how many of the question's words a chunk holds into its score; this parameter and chunk overlap aren't documented by Claris. A missing RAG space or model's error behavior is also undocumented, so the engine keeps its current behavior. Prompt-template `:question:` and `:context:` are filled in. **Remove Data** drops documents by `id`, or the whole space. There is no ANN index: a search compares every chunk, but a searched space's vectors are kept in memory (up to 256 MB per server process; changes by any process are picked up), so at 768 dimensions a search of a full space takes about 70 ms (about 0.7 s when the space is too big for the memory and is read from disk each time). A space holds at most 50,000 chunks. **GetRAGSpaceInfo ( ragAccountName {; spaceID} )** gives the file's spaces as `{"rag_space_list":[{"space_id","model"}]}`, or one space as `{"rag_space_id","model","entries","values":[{"id","filename"} or {"id","text"}]}`; a space that isn't there answers `[RAG Space] error. Reason: RAG space {id} not found`, and an account that wasn't set up answers `?` (a space's model is empty when the data was added before the server kept it). Send Prompt's options and the From Text / From File data keys are inferred, not read from a sample, so a step read from a .fmp12 may need its prompt set again in the step. | <!-- known-difference: Scripts and script steps ;; Send Prompt's options and the From Text / From File data keys are inferred, not read from a sample ;; A step read from a .fmp12 may need its prompt set again in the step ;; A sample file that uses the step -->
| Insert from URL (when network access is disabled) | Explicitly throws error 3 unless the run has network access or a fetch function. <!-- engine.ts --> |

## Does nothing

| Script step | What happens |
|---|---|
| Print Setup | Returns successfully without applying print settings. <!-- engine.ts --> |
| Open Help; Open Settings; Open Sharing; Open File Options; Open Hosts; Open Upload to Host; Open Favorites | Return successfully without opening their corresponding client flows. <!-- engine.ts --> |
| Refresh Portal | Returns successfully without an action. <!-- engine.ts --> |
| Show/Hide Text Ruler; Allow Formatting Bar; Enable Touch Keyboard | Show nothing, but keep the setting for the window the script is in (a new window starts with all three off), so Get ( TextRulerVisible ), Get ( AllowFormattingBarState ) and Get ( TouchKeyboardState ) give what the script set, for as long as the script runs. They are 0 until a script sets them, as Claris documents for a server or WebDirect. Only scripts written in the script editor set them; the same steps in an imported .fmp12 file or pasted FileMaker XML still do nothing, as their options aren't read yet. <!-- engine.ts --> |
| Set Layout Object Animation | Shows nothing, but Get ( ScriptAnimationState ) gives 1 after On and 0 after Off, for every window until the script ends (off to begin with, as Claris says). <!-- engine.ts --> |
| Edit User Dictionary; Set Dictionary | Return successfully without changing spelling dictionaries. <!-- engine.ts --> |
| Arrange All Windows | Returns successfully without arranging windows. <!-- engine.ts --> |
| Set Multi-User | Returns successfully without changing sharing; hosted files are always shared. <!-- engine.ts --> |

## Partly supported

| Script step | What happens |
|---|---|
| Install Plug-In File | Off (error 3) until an administrator runs `tabularius plugins <folder> script-install on`. Then it installs a `.ohplugin` package from the server's documents folder (file name only, as Insert File), if the script has full access and the package is signed by a publisher already trusted (`plugins/trusted-publishers.json`): an unsigned package, an untrusted publisher, or a plug-in another publisher signed is refused with error 3 and the reason, and a script without full access gets error 9. Installing does not turn the plug-in on for any file: that stays `enabled.json`. Each install and each refusal is in the file's security log ("Plug-ins"). The stored-file option is read as Insert File's is, not yet seen in a .fmp12. <!-- engine.ts installPluginFile --> | <!-- known-difference: Scripts and script steps ;; The stored-file option is read as Insert File's is, and has not been seen in a .fmp12 ;; A step read from a .fmp12 may take the wrong source ;; A sample file with the step -->
| Import Records | Add, Update matching, and Replace work with text or structured parameters; authored steps keep implicit Add. Binary steps with an undecoded mode return error 3 before source access or record changes, including binary Add imports. Binary action/match/add-remaining/auto-enter options are not decoded; clipboard import does not establish a mode. Explicitly author the mode and review these other options before running binary imports. Reads comma- and tab-separated text, merge, Excel, FileMaker XML and hosted FileMaker files (text saved as UTF-8, UTF-16 with its byte order mark, or Windows-1252, which is what is read when the bytes are not valid UTF-8; a .csv is read by the separator its first line uses, so a semicolon or pipe file comes in as columns, and a .txt is tab-separated unless every one of its first lines has the same number of semicolons or pipes; the step's own format wins over the file name; a quote that is never closed reads the rest of the file as one value, and a script has no place to say so, though the web client's import does; an Excel workbook is read from its first sheet, or from `Worksheet: “name”` in script text, error 715 when the workbook has no such sheet, and a workbook that counts days from 1904 is read as the same dates; FileMaker XML dates, times and timestamps are read by the file's DATEFORMAT and TIMEFORMAT; a leading apostrophe that a text export put before a minus sign or `=` is taken off for a number, date, time or timestamp field only), and a folder of files in the documents folder (script text only: `Folder: “name”`, `File type: Text files` or `Picture and movie files`, `Include enclosed folders: On`; up to 100 levels, files in path order, hidden files and aliases that leave the folder or lead to folders skipped; columns are Text Content, File Name, File Path, or Image (into a container), File Name, File Path, Image Thumbnail (always empty); File Path is relative to the documents folder; no “import only a reference” option); “Specify XML and XSL Options” (script text only: `XSLT: “file.xsl”`, a style sheet in the documents folder, applied to the XML source before the import reads it; the result must be FMPXMLRESULT, else error 954; a document or style sheet that does not parse is error 718, a failed transform 719; an HTTP request or calculation as the XML or style sheet source is not supported); repeating sources and targets are supported, but a mapping cannot name a repetition or use a repeating match field. <!-- engine.ts importRecords --> |
| Revert Transaction | Unconditional binary steps without option evidence work. Imported condition/error options with unresolved semantics return error 3 without reverting. Explicit text/structured conditions and custom error options remain supported. |
| Set Revert Transaction on Error | Explicit On/Off works. An unspecified or undecoded imported state returns error 3 and leaves the existing setting unchanged. |
| Send Mail via E-mail Client | In the web client the person's own mail app opens with the message (a mailto: link with To, CC, BCC, Subject and Message), as WebDirect does, and they send it. Attachments can't go in a mailto: link and are left out; one message is made, from the current record. <!-- engine.ts case 63, mailtoUrl --> |
| Send Mail via SMTP Server | Sends only on a server started with `serve --send-mail --mail-from ADDRESS` and an SMTP account of the administrator's (TABULARIUS_SMTP or ~/.openhbam/smtp). The step's own SMTP server and password are not used: mail goes through that account, from that address, with the script's From name shown and its From address as Reply-To. To, CC and BCC as the script names them (up to 100 together); a missing attachment or a bad address is error 1506 and nothing is sent. Never from a capture-only file (named with `--capture-only` or TABULARIUS_CAPTURE_ONLY), nor while one is in the server's folder. Scripts an AI runs and runs on a copy (dry runs, the debugger's scratch copies) never send, and neither do automations or inbound hooks (error 3); schedules and Perform Script on Server do. One message per step: the "multiple emails, one per record" option isn't decoded. <!-- engine.ts sendSmtp, server/src/smtp.ts mailTransport --> |
| Send Mail (outbound test mode) | Captures a redirected test copy; it does not send the production message. SMTP credentials are not decoded. <!-- engine.ts --> |
| Insert from URL | HTTP and HTTPS only. Binary responses are kept as container data (in a container field, or a variable when the response isn't text) and text is decoded by its charset; responses over 64 MB fail with error 1631; cURL options handled: -X, -H, -d/--data(-raw/-binary/-ascii), --data-urlencode, -G, -F/--form (a container variable as `name=@$var`), -I, -D, -f, -u, --oauth2-bearer, -A, -e, -b (cookie text), -m/--max-time, --no-compressed (asks for the body as it is), --connect-timeout (gives up if the server hasn't begun to answer in that time; fetch can't tell connecting from waiting for the first byte, so it is the time until the response's headers arrive), --max-filesize (a response over it fails with error 1631, by its stated length or as it arrives; the 64 MB limit still applies), --FM-return-container-variable (into a variable, a text response is stored as a container), `--aws-sigv4 provider1:provider2:region:service` with `-u id:secret` (signs a request with `--data` or no body, not a form upload; refused with a connection, which adds its own credentials); sign-in: `-u user:password` (Basic, sent with the first request, as `--basic` also says), `--digest` and `--anyauth` (the first request carries no credentials; on a 401 the Digest challenge of RFC 7616 is answered once with MD5, MD5-sess, SHA-256 or SHA-256-sess and qop auth, checked against the RFC's worked examples; `--anyauth` takes Basic when that is all the server offers; a challenge it cannot answer, such as qop auth-int only, leaves the 401 as the result); options that name files on disk (-T, -o, -F name=@file, a cookie file) and other flags are ignored; `--data-binary @$var` with a container in the variable sends the file as it is, with its own content type. An address like `connection://name/path` goes through a connection set up in the admin console (S3-compatible storage: GET, HEAD, PUT and DELETE on objects inside the connection's folder, `connection://name/?prefix=` to list it; a REST connection: any path under its base address, read-only unless it was given write access), which adds its credentials; the script never has them, and a capture-only file's scripts never get one. <!-- engine.ts --> |
| Save Records as PDF | Writes a PDF. Append adds the pages after those of the PDF already at that path (or writes a new one when there is none), as an incremental update that leaves the existing bytes as they were. It works on PDFs with a classic cross-reference table, as Tabularius makes, and on PDF 1.5 files with compressed cross-reference and object streams (Flate, with or without the PNG predictors), as many other writers make; an encrypted PDF, one compressed some other way, a damaged one, or one over 256 MB gives error 800 and is left unchanged. Append and Create folders are read from converted .fmp12 files too. Tabularius embeds TrueType subsets with ToUnicode maps for WinAnsi, simple Hebrew runs, and selected single-codepoint emoji. Unsupported characters remain extractable through ActualText but appear as replacement glyphs. Complex-script shaping, full bidirectional layout, emoji sequences, and colour management are unsupported. <!-- engine.ts --> |
| Open PDF; Append PDF | Open PDF opens a PDF from the documents folder, or from a container field or variable, to add to and save with Close PDF; only one PDF is open at a time (error 833). Append PDF adds every page of another PDF to the end of the open one (error 829 when none is open); Save Records as PDF with Currently open PDF adds its pages after them. The original file is not touched unless Close PDF writes to the same path; an Open PDF closed with nothing added writes the same bytes. Errors: 830 the file is not found or is not a PDF, 831 an encrypted PDF without a password, 832 an encrypted PDF given a password (encrypted PDFs are not decrypted here). Pages are copied as they are; links between pages of the same file are kept, but outlines, form fields, named destinations and the document information of the sources are not carried over. Script text only (`From: File ; “a.pdf”` or `From: Source ; Source: $pdf`, `Password: calc`); the binary options of a converted file are undecoded, so those steps answer error 3. <!-- engine.ts openExistingPdf, appendToOpenPdf, calc pdf-text.ts pdfMerge --> |
| New Window | Creates window state, but the file decoder distinguishes Card style from other styles only. <!-- engine.ts --> |
| Go to Related Record | Replaces the found set with related IDs. The binary decoder does not populate `matchFoundSet`. <!-- engine.ts --> |
| Open Record/Request | Checks the record can be edited (error 200) and locks it until the script commits or reverts, as Set Field and the other field edits do; a record someone else is editing is error 301. Runs with no session or schedule behind them (the command line) check for others' locks but take none. <!-- engine.ts lockForEdit --> |
| Insert Text; Paste; Insert Calculated Result; Cut; Copy; Clear | With Select entire contents they replace (or copy, cut, clear) the whole field. Without it they work as Claris documents: Insert Text, Insert Calculated Result and Paste replace the selected text in the active field, or go in at its insertion point (the end of the field unless Set Selection moved it); into a field that isn't active, a container field or a calculated repetition they replace the whole value; into a `$variable` Insert Text and Insert Calculated Result add to the end. Cut, Copy and Clear take only the selected text, or the whole field when nothing is selected in it. In the web client, Paste with nothing copied or cut in the script pastes the text on the person's own clipboard; the browser may ask them first, and when it won't let the page read the clipboard they paste into a box. A run with no one to ask (a schedule, the Data API) pastes only what it copied. The decoder doesn't read the Select entire contents flag from a converted .fmp12 yet, so those steps act as with Select; it is read from script text and pasted XML. <!-- engine.ts --> |
| Print | Requests client printing; Print Setup does not apply per-step print settings. Save Records as PDF uses the stored file paper size, orientation and fixed margins, but ignores Page Setup scale. <!-- engine.ts --> |
| Sort Records; Sort Records by Field | Ascending, descending and custom (value list) orders all sort. Sort Records by Field with a custom order uses the value list of the field's object on the layout. Only script text names a Sort Records step's custom-order value list. A step read from a converted .fmp12 (the binary reference isn't decoded) or from pasted XML doesn't carry it yet, so it stops with error 105. <!-- engine.ts sortIds, case 39 --> |
| Commit Records/Requests; Open Transaction | Skip data entry validation (on either step; for Open Transaction, every write inside the transaction) skips fields validated “Only during data entry” and still checks those validated “Always”. Open Transaction's Skip auto-enter options runs no auto-enter for writes inside the transaction, Import Records included. Both are read from .fmp12 files and script text; Commit's is also read from pasted XML. Override ESS locking conflicts has nothing to override. With Skip auto-enter options off, auto-enter runs as each record is written rather than all at Commit Transaction. <!-- engine.ts --> |
| Export Records; Save Records as Excel | Supports CSV, tab-separated, merge, XLSX, FileMaker XML (FMPXMLRESULT, chosen by a .xml name) and HTML table (.htm/.html). “Specify XML and XSL Options” work from script text: `Grammar: FMPXMLRESULT` (the default) or `FMPDSORESULT` (an element per field named as Claris describes, a DATA per repetition of a repeating field; a field name that is not an XML name, such as one that starts with a digit, is error 954) and `XSLT: “file.xsl”` (a style sheet in the documents folder run over the grammar, writing its XML, HTML or text under whatever file name the step gives; a failed transform is error 719). A repeating field exports every repetition (group-separated in comma-, tab-separated and merge text, one DATA each in XML), or only the one the field order names; Excel and HTML give its first. Excel writes dates, times and timestamps as real date cells (formatted yyyy-mm-dd, hh:mm:ss, yyyy-mm-dd hh:mm:ss), which is Tabularius's choice: what Claris writes is not known. Other formats explicitly fail; the chosen text encoding is UTF-8 or UTF-16 (UTF-16 text starts with a byte order mark so it reads back through Import Records). <!-- engine.ts --> |
| Insert Current Date; Insert Current Time; Insert Current User Name | Inserts at the current selection in the active field when no target is given; explicit field and `$variable` targets are supported. User Name uses AccountName. <!-- engine.ts --> |
| Insert from Last Visited | Sets the whole target field to its value in the record this window's table was on before the current one. A script started from the web client also knows the record the window showed before the one it started on; other runs (schedules, the Data API) know only the records visited during the run. Error 101 when there is none, or it has been deleted or can't be seen. <!-- engine.ts --> |
| Insert from Index | In the web client the person picks a value from the field's View Index (up to 2,000 values, only from records the script's privileges can see). With an explicit target the field is set to the value; without one it goes in at the active field's insertion point, or over it all with Select. Cancel is error 1. With no one to ask (a server-side run, the Data API) it is error 3, as on FileMaker Server. |
| Freeze Window; Refresh Window | In the web client, after Freeze Window a Show Custom Dialog, Insert from Index or Insert from Device opens over the screen as it was, until Refresh Window or a Pause shows what the script has done; the freeze ends with the script. The Sort dialog repaints first (it lists the layout's fields). Refresh Window's options (flushing cached join results) do nothing, and runs with no browser do nothing with either. <!-- engine.ts case 79, 80 --> |
| Adjust Window | As in FileMaker WebDirect ("only the Resize to Fit option is available, which works with cards"), Resize to Fit on a card gives it back its layout's own size (the place it had stays). Maximize, Minimize, Restore and Hide, and any option on a document window, do nothing. <!-- engine.ts case 31 --> |
| Move/Resize Window | As in FileMaker WebDirect ("supported only for cards"), it sizes and places a card window, or another window drawn over the one behind it; a document window fills the browser window and stays as it is. The current window, or one found by name and then by Get ( WindowUUID ), ignoring case; one that isn't open is error 112. A value left empty keeps the window's own; heights and widths under 50 points are 50, and the web client keeps the card inside the browser window. Get ( WindowHeight ), ( WindowWidth ), ( WindowTop ) and ( WindowLeft ) give a card's size and place once New Window or this step gave them. Runs with no browser window (a schedule, the Data API) do nothing with it. <!-- engine.ts Move/Resize Window --> |
| Allow User Abort; Set Error Capture | Allow User Abort decides whether the person can stop the script in the web client (the Stop note, Esc or ⌘-period); runs with no one to stop them aren't affected. With Set Error Capture off, a step that fails shows its error to the person in the web client, with Continue and Cancel (Cancel halts the script); runs with no one to answer carry on. No dialog for a person's own cancel (1), a step this server can't run (3), a trigger's cancel (20), running off the end with Go to Record or Go to Portal Row (101), or a menu command (which tells its own result); that these show none is inferred. FileMaker's own dialog text isn't copied: ours names the error and the step. <!-- engine.ts --> | <!-- known-difference: Scripts and script steps ;; Which errors show no dialog (a person's own cancel, a step this server cannot run, a trigger's cancel, running off the end with Go to Record or Go to Portal Row, a menu command) is inferred; the dialog text is ours ;; An error dialog may appear or not where FileMaker's does not or does ;; A FileMaker run of a script hitting each -->
| Undo/Redo | Undo puts back the field the last uncommitted edit in the current record changed, Redo makes an undone edit again, Toggle does whichever didn't happen last. It covers the edits the script made since the record was last committed or reverted; the person's own typing before the script started isn't known to it. With nothing to undo it does nothing (inferred). In a converted .fmp12 file the choice is read as the dialog lists it (1 Undo, 2 Redo, 3 Toggle), inferred because no sample file has the step. <!-- engine.ts undoRedo --> | <!-- known-difference: Scripts and script steps ;; Undo or Redo with nothing to undo does nothing (inferred), and the option read from a .fmp12 (1 Undo, 2 Redo, 3 Toggle) is inferred because no sample file has the step ;; A step read from a .fmp12 may take the wrong choice ;; A sample file with the step, and a FileMaker run -->
| Loop | The Flush option changes nothing here: the web client keeps no record cache for it to flush, so every Flush setting behaves the same. Tabularius's own guard, which FileMaker doesn't have: a loop with a Go to Record/Request/Page step that is still on the record it started on after 10,000 passes is stopped, with the loop's line and the Go to Record step's line in the message. <!-- engine.ts --> |
| Scroll Window | Home, End, Page Up, Page Down and To Selection scroll the person's window in the web client, in the order the steps ran, once the window shows what the script left; runs with no window (schedules, the Data API) do nothing. Page Up and Page Down move by the window's height less a line. In a script read from an .fmp12 file the option is taken as the dialog lists it (1 Home to 5 To Selection), inferred because no sample file has the step; script text and the Script Workspace carry it by name. <!-- engine.ts case 81, main.ts scrollWindow --> | <!-- known-difference: Scripts and script steps ;; The option read from a .fmp12 (1 Home to 5 To Selection) is inferred because no sample file has the step ;; A step read from a .fmp12 may scroll the wrong way ;; A sample file with the step -->
| Insert File; Insert Picture; Insert PDF; Insert Audio/Video | The picture, PDF, and audio/video variants share the Insert File handler. The file's contents are always stored in the container, whatever the “store only a reference” option says: the web client has no way to keep a reference to a file on the person's computer, and Claris says FileMaker Go uses Insert here too. Claris lists the step as not supported on FileMaker Server and the Data API, and WebDirect without the dialog and source-file options. <!-- engine.ts --> |
| Export Field Contents | In the web client the file goes to the person as a download named after the path's last part. On runs with no one to download to (schedules, the Data API, the command line) it is written to the documents folder, as Export Records is; it never writes outside that folder. <!-- engine.ts --> |
| Save Records as Snapshot Link | Writes the found set's record IDs, or only the current record's with Current record; the view is the one the window shows (form, list or table, as View As left it) and the toolbar is always shown. <!-- engine.ts snapshotLink --> |
| Execute FileMaker Data API | `options.prohibitmode: "script"` may write fields that prohibit modification; `entrymode: "script"` skips validation set to "only during data entry" (fields validated "Always" are still checked). An update's `fieldData.deleteRelated` removes portal rows. <!-- engine.ts --> |
| Install OnTimer Script | Runs in the web client's window. A script from another hosted file runs as Perform Script runs it, with the account's privileges in that file. <!-- engine.ts onTimer, webclient.ts clientActions --> |
| Set Use System Formats | Changes the flag Get ( UseSystemFormatsState ) reports; formatting keeps using the formats saved with the file. Claris supports the step in FileMaker Pro and Go only, not in WebDirect, Server or the Data API, so this matches what those do. <!-- engine.ts --> |
| Read from Data File | Each read is capped at 64 MiB. <!-- engine.ts --> |
| Perform Find by Natural Language | Get: Found Set, Found Set as JSON (a Data API find response, the found set unchanged) and Find Request as JSON (the generated query and sort, no find) all run. The model sees the current layout's field names only. <!-- engine.ts --> |
| Perform SQL Query by Natural Language | The model sees the chosen tables as DDL, with only the tables and fields the account can see and no record data. Its SELECT runs as ExecuteSQL does, with the account's privileges, and a query that fails goes back to the model with its error, up to three tries in all; if none runs, the step returns error 1200 (a guess, since Claris doesn't document it). Get DDL never asks the model. Query sends the result (up to 500 records) back to the model for an answer in words. Query for Data Only returns the rows as ExecuteSQL does (commas and returns). Get SQL returns every query the model wrote, one per line. Get First SQL Only returns the first query without running it. When the model finds nothing relevant, its reason is the response and the error is 0. The options are read from script text only, because no .fmp12 sample has the step, and the script-text labels for the tables (Tables, Table Names, DDL) are guesses. Options by JSON data, Stream, Parameters and Perform JavaScript in Web Viewer are kept but not used. <!-- engine.ts sqlByNaturalLanguage --> |
| Generate Response from Model | Agentic mode, tools, and streaming are not decoded. Message History Count retains that many previous question/answer pairs. <!-- engine.ts --> |
| Insert Embedding; Insert Embedding in Found Set; Perform Semantic Find | Need an embedding model on the server (`--ai-embed-url` and `--ai-embed-model`, any OpenAI-compatible endpoint; `--ai-embed-url ollama` or `lmstudio` runs one on the same computer with no key, see [local-embeddings.md](local-embeddings.md)); without one they stop with error 3. Embedding input is text-only; Insert Embedding in Found Set sends Parameters' MaxRecPerCall records per call (default 20) and honours Replace target contents and Continue on error when written in the script editor; a step read from a file always replaces, since those options aren't decoded yet. Query by Image sends the picture in Text to the server's image embedding model (`--ai-image-embed voyage`, see [local-embeddings.md](local-embeddings.md#searching-by-image)); without one it is error 3. <!-- engine.ts --> |
| Configure AI Account; Set AI Call Logging; Configure Prompt Template | Account API key/endpoint are ignored; Set AI Call Logging performs no operation; templates are retained for Perform Find by Natural Language and Perform SQL Query by Natural Language (the SQL prompt's :schema: and :question:, and the natural-language prompt's :question:, :sql_query: and :sql_results:, are filled in). <!-- engine.ts --> |

Refresh Window, Refresh Portal, Refresh Object and Set Web Viewer have dedicated handlers. Web-client runs acknowledge automatic checkpoints before subsequent script steps. Refreshes read new unstored values and layout calculations under the viewing account, preserve the found set, and do not commit or move focus. Join flushing evicts relationship query caches in the involved hosted stores. External-data flushing is retained as an empty operation because ESS/ODBC providers are unsupported. Freeze Window suspends painting until Refresh Window or the end of the run.

Set Web Viewer supports Reset, Reload, Go Back, Go Forward and calculated Go to URL for the existing offline viewer surface. Inline HTML retains the sandbox and request-blocking policy. Viewer history includes script-selected addresses and hash navigation reported through the validated frame bridge; other in-document document navigation and arbitrary external websites remain unsupported. JavaScript calls acknowledge completion before the next viewer command.

Text and XML parameters preserve refresh options and repetition expressions. Unverified binary flush flags, portal-name slots, object repetition slots and viewer action codes remain undecoded. Imported binary steps with these options explicitly report error 3 and a retained warning (unsupported imported options); they are never treated as omitted. Use text or XML steps until FileMaker-generated fixtures establish the encodings. Set Web Viewer's binary name and URL formulas are verified against the generated Flicks DDR; a populated URL slot does not imply an action code. <!-- known-difference: Scripts and script steps ;; Binary flush flags, portal-name slots, object repetition slots and viewer action codes of imported binary steps are undecoded ;; Such a step reports error 3 and a retained warning (unsupported imported options); it is never treated as omitted ;; Sample files that set those options -->

## Script triggers set off by steps

A step that takes the window to another layout, mode or record runs that
layout's OnLayoutEnter, OnModeEnter and OnRecordLoad triggers, in that order,
before the next step, as FileMaker does. The step's own Get ( LastError ) and
Get ( ScriptResult ) are kept. Import Records and Perform Find/Replace set off
none (Claris lists them among actions that don't activate triggers).

Before Go to Layout (or Go to Related Record showing its records on another
layout in the same window) leaves the layout, an Enter … Mode step leaves the mode,
or Commit Records/Requests or Revert Record/Request acts on a changed record,
OnLayoutExit, OnModeExit, OnRecordCommit or OnRecordRevert runs first. A step
that moves off a changed record commits it, so it runs OnRecordCommit first
too: Go to Record, Go to Related Record, New Record, Duplicate Record, Go to
Layout, Enter Find Mode, Modify Last Find, Show All, Omit, Show Omitted Only,
Perform / Constrain / Extend Find, Find Matching Records, Perform Quick Find,
Sort Records, Sort Records by Field, New / Select / Close Window and Go to Field
with no field. A step that fails before it gets that far (a find with nothing
to find, Go to Object naming no object) runs none of them.
Inside a transaction OnRecordCommit and OnRecordRevert don't run (Claris). A
trigger script that exits with False cancels the step, which sets error 20
("Command/operation canceled by triggered script"). A trigger doesn't set
itself off again while its own script runs (an OnRecordCommit script that
commits, say); that FileMaker behaves the same is inferred, not documented. <!-- known-difference: Scripts and script steps ;; That a trigger does not set itself off again while its own script runs (an OnRecordCommit script that commits) is inferred, not documented ;; A trigger script that commits does not recurse ;; A FileMaker run of that script -->

Go to Field, Go to Next / Previous Field, Go to Object and Set Selection run
the field object's OnObjectExit before the cursor leaves it (exiting False
keeps it there, with error 20) and the new field's OnObjectEnter after. A
step that commits the record takes the cursor out of its field too, so it runs
OnObjectExit first. When several run, the order is Claris's: OnObjectExit,
OnRecordCommit, OnModeExit, OnLayoutExit. The web
client tells the script which field the cursor is in as it starts, so a
field's own trigger script starts with the cursor in that field. Only for that
field's own trigger, and only a field the person could have tabbed into and may
see.

View As runs the layout's OnViewChange after it switches the view (Claris:
"after you switch views (Form, List, Table) manually or in a script step"),
and not when the view stays as it was. It switches only to a view the layout
allows; Cycle goes to the next allowed one (form, list, table). A script starts
in the view the web client shows, and Go to Layout shows the layout in its own
view (the one FileMaker saved with it, or for a layout made in Tabularius the one
the web client picks), running no OnViewChange; Claris doesn't say whether
FileMaker runs it there. Get ( LayoutViewState ) gives the view (0 form, 1
list, 2 table).

OnLayoutSizeChange runs after OnRecordLoad when a step opens a window (New
Window, Go to Related Record in a new window), and after Move/Resize Window
changes the size of a window, the one the script is in or another one named in
the step (it runs in that window), not when it only moves it (Claris: "by
script step", and "when a window is first opened").

Close Window runs the window's OnLayoutExit before it closes it (Claris: the
trigger "can be activated when the window is closed"), and exiting False keeps
it open. Closing another window runs that window's own OnLayoutExit, in that
window, in the same way.

Insert Text, Insert Calculated Result, Insert Current Date / Time / User
Name, Insert from Index, Insert from Last Visited, Cut, Paste and Clear run the changed field's OnObjectModify after the
step (Claris: "script steps such as the Insert Text script step that change a
field"): the object the cursor is in when it shows that field, else the first
on the layout that does. Set Field doesn't, as in FileMaker. Leaving a field
one of those steps changed runs its OnObjectValidate and OnObjectSave before
OnObjectExit, and any of them exiting False keeps the cursor there; once
OnObjectSave has run, the field counts as saved.

Revert Record/Request takes the cursor out of its field as a commit does, so
it runs the field's OnObjectExit (exiting False keeps the cursor and the
change, with error 20), then OnRecordRevert for a changed record. A field it
changed is neither validated nor saved first, since the change is thrown
away. That the cursor leaves the field, and this order, are inferred, not <!-- known-difference: Scripts and script steps ;; That the cursor leaves the field when a record is reverted, and the order OnObjectExit then OnRecordRevert, are inferred ;; Triggers run in that order ;; A FileMaker run with both triggers -->
documented.

A step that opens another hosted file no window shows yet (Open File, or
Perform Script of one of its scripts) opens it hidden on its "Switch to layout"
(its first layout when there is none or the account can't see it) and runs its
OnFirstWindowOpen script there before going on; the script stays in its own
window. Close File runs the file's OnLastWindowClose before closing its
windows, unless the script's own window is one of them, and so does Close
Window on another file's last window. That a script opening a
file runs the trigger, as a person opening it does, is inferred from Claris <!-- known-difference: Scripts and script steps ;; That a script opening a file runs OnFirstWindowOpen as a person opening it does is inferred from Claris ('after the first window of a file is opened') ;; The trigger runs when a script opens a hosted file ;; A FileMaker run of Open File with the trigger set -->
("after the first window of a file is opened"); exiting OnLastWindowClose with
False doesn't keep the file open.

OnWindowOpen and OnWindowClose are File Options triggers (Claris puts them under File options, with OnFirstWindowOpen
and OnLastWindowClose). They aren't decoded from a FileMaker file, so they are set in design mode (File options on the
Layouts tab, or `setFileOptions`) and live in the file's own format. OnWindowOpen runs in each window a step opens (New
Window, Go to Related Record in a new window, a file opened by Open File), before that window's OnLayoutEnter, OnRecordLoad
and the rest (Claris's list: OnFirstWindowOpen, OnWindowOpen, OnLayoutEnter, OnModeEnter, OnRecordLoad,
OnLayoutSizeChange, OnViewChange). In the web client a window opened by a person (the first one, or Window > New Window)
runs it after the window has shown its layout, as it already runs OnFirstWindowOpen, so there it follows that window's
layout triggers, not the other way round. OnWindowClose
runs when Close Window closes a window of the script's file or another file's, after that window's OnLayoutExit and before
the file's OnLastWindowClose (Claris's list: OnModeExit, OnLayoutExit, OnWindowClose, OnLastWindowClose); a script that
exits False keeps the window open (error 20), and Claris lists OnWindowClose among the triggers that run before their event.
The script's only window is not closed by Close Window, so runs nothing. Not run: OnWindowClose for the windows Close File
closes (Claris doesn't say), and for a browser tab closed with the browser's own button (a page cannot wait for a script;
File > Close, Close Window and logging out do run it). A trigger doesn't set itself off: an OnWindowOpen script that opens a
window runs once. That OnWindowOpen follows OnFirstWindowOpen for a file a step opens, and that it runs for the windows a
step opens in other files, is inferred from the same list. <!-- known-difference: Scripts and script steps ;; OnWindowOpen following OnFirstWindowOpen, and running for windows a step opens in other files, are inferred from Claris's trigger list, not from a documented rule ;; The order or the other-file case may differ from FileMaker ;; A FileMaker run of a file with both triggers -->

OnObjectValidate and OnObjectSave are not run for a field that Set Field changed while the cursor was in it: the Claris
trigger pages read don't say that Set Field marks the field as changed (they say it doesn't activate OnObjectModify), so
the current behaviour stands and a test pins it. OnObjectKeystroke runs from typing in the web client (tested in a
browser), as in FileMaker, never from a step.
<!-- known-difference: Scripts and script steps ;; OnWindowOpen and OnWindowClose are not read from a FileMaker file (they run when set in design mode), and OnObjectValidate / OnObjectSave do not run for a field Set Field changed while the cursor was in it ;; A window trigger set in FileMaker does not run here until it is set again in design mode ;; A sample file that decodes the window triggers, and a FileMaker run for the field case -->

Undecoded options remain visible in script text and Design checks. Replace the
warning with the intended options; for binary Import Records, explicitly choose
Add, Update or Replace and review match fields, add-remaining and auto-enter.
Binary On and Off steps both need re-authoring for Set Revert Transaction on
Error; bare authored steps also require an explicit state. Revert Transaction
conservatively refuses retained calculation or option payloads, including stale
ones. Error 3 does not automatically revert an open transaction, and scripts
continue after the error: later steps can still write or commit.

Design version 47 refreshes decoded metadata when the original source is
available; it does not change record data. Older retained Revert Transaction
slots/calculations identify some unresolved steps, but discarded flags and
formulas cannot be recovered. A bare legacy rollback with no surviving evidence
is indistinguishable from a legitimate unconditional rollback and stays
executable. Design-log replay can restore old structured snapshots over the
refreshed source, so a version bump alone cannot recover lost evidence. Detached
stores, encrypted sources unavailable for refresh, and replayed snapshots with
lost evidence require source comparison and re-authoring of affected transaction
steps. Authored text/structured imports keep implicit Add; older binary imports
whose decoder provenance was discarded cannot be distinguished from them.

## Script step ID matrix

This matrix covers every ID in `script-steps.ts`. `case` means a named branch exists in the binary decoder or execution engine; `fallback` means the binary decoder retains formula slots without a step-specific branch; `unsupported` means the execution engine has no case for the ID; `no-op` marks comment rows. A case does not imply every option is decoded or executable. The test parses, prints, and reparses one bare authored step for each row. Rows marked Select option also test that option through parsing, printing, and reparsing. Other options have separate focused tests or have not been audited by this matrix.

Script text rejects `Select` on [Write to Data File](https://help.claris.com/en/pro-help/content/write-to-data-file.html) and `With dialog` on [Reset Account Password](https://help.claris.com/en/pro-help/content/reset-account-password.html), because those steps have no such option. A variable target on [Set Selection](https://help.claris.com/en/pro-help/content/set-selection.html) is also rejected. This is a compatibility break: older Tabularius text such as `Set Selection [ $field ]` parsed, but could not print the variable back. Rewrite it with a field target or use the active field.

Claris documents Select entire contents on [Check Selection](https://help.claris.com/en/pro-help/content/check-selection.html), [Clear](https://help.claris.com/en/pro-help/content/clear.html), [Copy](https://help.claris.com/en/pro-help/content/copy.html), [Cut](https://help.claris.com/en/pro-help/content/cut.html), [Execute FileMaker Data API](https://help.claris.com/en/pro-help/content/execute-filemaker-data-api.html), [Insert Calculated Result](https://help.claris.com/en/pro-help/content/insert-calculated-result.html), [Insert Current Date](https://help.claris.com/en/pro-help/content/insert-current-date.html), [Insert Current Time](https://help.claris.com/en/pro-help/content/insert-current-time.html), [Insert Current User Name](https://help.claris.com/en/pro-help/content/insert-current-user-name.html), [Insert from Index](https://help.claris.com/en/pro-help/content/insert-from-index.html), [Insert from Last Visited](https://help.claris.com/en/pro-help/content/insert-from-last-visited.html), [Insert from URL](https://help.claris.com/en/pro-help/content/insert-from-url.html), [Insert Text](https://help.claris.com/en/pro-help/content/insert-text.html), and [Paste](https://help.claris.com/en/pro-help/content/paste.html). The reader accepts Select on these steps. Old Data API and URL text with no Select keeps Tabularius's previous replacement behavior; newly printed text says `Select` for replacement or `Select: Off` for append. `Select: Off` is a Tabularius compatibility spelling, not FileMaker script workspace syntax. Existing text may also spell `Select` on Sort Records by Field; that spelling is retained through printing and has no sorting effect, though [Claris lists no Select option for that step](https://help.claris.com/en/pro-help/content/sort-records-by-field.html).

| ID | Step | Decoder | Engine | Text coverage |
| ---: | --- | --- | --- | --- |
| 1 | Perform Script | case | case | bare round trip |
| 3 | Save a Copy as XML | fallback | case | bare round trip |
| 4 | Go to Next Field | fallback | case | bare round trip |
| 5 | Go to Previous Field | fallback | case | bare round trip |
| 6 | Go to Layout | case | case | bare round trip |
| 7 | New Record/Request | fallback | case | bare round trip |
| 8 | Duplicate Record/Request | fallback | case | bare round trip |
| 9 | Delete Record/Request | case | case | bare round trip |
| 10 | Delete All Records | case | case | bare round trip |
| 11 | Insert from Index | fallback | case | Select option round trip |
| 12 | Insert from Last Visited | fallback | case | Select option round trip |
| 13 | Insert Current Date | fallback | case | Select option round trip |
| 14 | Insert Current Time | fallback | case | Select option round trip |
| 16 | Go to Record/Request/Page | case | case | bare round trip |
| 17 | Go to Field | case | case | bare round trip |
| 18 | Check Selection | fallback | unsupported | Select option round trip |
| 19 | Check Record | fallback | unsupported | bare round trip |
| 20 | Check Found Set | fallback | unsupported | bare round trip |
| 21 | Unsort Records | fallback | case | bare round trip |
| 22 | Enter Find Mode | case | case | bare round trip |
| 23 | Show All Records | fallback | case | bare round trip |
| 24 | Modify Last Find | fallback | case | bare round trip |
| 25 | Omit Record | fallback | case | bare round trip |
| 26 | Omit Multiple Records | case | case | bare round trip |
| 27 | Show Omitted Only | fallback | case | bare round trip |
| 28 | Perform Find | case | case | bare round trip |
| 29 | Show/Hide Toolbars | case | case | bare round trip |
| 30 | View As | case | case | bare round trip |
| 31 | Adjust Window | case | case | bare round trip |
| 32 | Open Help | fallback | case | bare round trip |
| 33 | Open File | case | case | bare round trip |
| 34 | Close File | case | case | bare round trip |
| 35 | Import Records | case | case | bare round trip |
| 36 | Export Records | case | case | bare round trip |
| 37 | Save a Copy as | case | case | bare round trip |
| 38 | Open Manage Database | fallback | case | bare round trip |
| 39 | Sort Records | case | case | bare round trip |
| 40 | Relookup Field Contents | fallback | case | bare round trip |
| 41 | Enter Preview Mode | fallback | case | bare round trip |
| 42 | Print Setup | fallback | case | bare round trip |
| 43 | Print | fallback | case | bare round trip |
| 44 | Exit Application | fallback | case | bare round trip |
| 45 | Undo/Redo | case | case | bare round trip |
| 46 | Cut | case | case | Select option round trip |
| 47 | Copy | case | case | Select option round trip |
| 48 | Paste | case | case | Select option round trip |
| 49 | Clear | case | case | Select option round trip |
| 50 | Select All | fallback | case | bare round trip |
| 51 | Revert Record/Request | case | case | bare round trip |
| 55 | Enter Browse Mode | fallback | case | bare round trip |
| 56 | Insert Picture | fallback | case | bare round trip |
| 57 | Send Event | fallback | unsupported | bare round trip |
| 60 | Insert Current User Name | fallback | case | Select option round trip |
| 61 | Insert Text | case | case | Select option round trip |
| 62 | Pause/Resume Script | case | case | bare round trip |
| 63 | Send Mail | case | case | bare round trip |
| 64 | Send DDE Execute | fallback | unsupported | bare round trip |
| 65 | Dial Phone | fallback | case | bare round trip |
| 66 | Speak | fallback | unsupported | bare round trip |
| 67 | Perform AppleScript | fallback | case | bare round trip |
| 68 | If | case | case | bare round trip |
| 69 | Else | fallback | case | bare round trip |
| 70 | End If | fallback | case | bare round trip |
| 71 | Loop | fallback | case | bare round trip |
| 72 | Exit Loop If | case | case | bare round trip |
| 73 | End Loop | fallback | case | bare round trip |
| 74 | Go to Related Record | case | case | bare round trip |
| 75 | Commit Records/Requests | case | case | bare round trip |
| 76 | Set Field | case | case | bare round trip |
| 77 | Insert Calculated Result | case | case | Select option round trip |
| 79 | Freeze Window | fallback | case | bare round trip |
| 80 | Refresh Window | case | case | bare round trip |
| 81 | Scroll Window | case | case | bare round trip |
| 82 | New File | fallback | unsupported | bare round trip |
| 83 | Change Password | fallback | case | bare round trip |
| 84 | Set Multi-User | fallback | case | bare round trip |
| 85 | Allow User Abort | case | case | bare round trip |
| 86 | Set Error Capture | case | case | bare round trip |
| 87 | Show Custom Dialog | case | case | bare round trip |
| 88 | Open Script Workspace | fallback | case | bare round trip |
| 89 | # (comment) | fallback | no-op | bare round trip |
| 90 | Halt Script | fallback | case | bare round trip |
| 91 | Replace Field Contents | case | case | bare round trip |
| 92 | Show/Hide Text Ruler | fallback | case | bare round trip |
| 93 | Beep | fallback | case | bare round trip |
| 94 | Set Use System Formats | fallback | case | bare round trip |
| 95 | Recover File | fallback | unsupported | bare round trip |
| 96 | Save a Copy as Add-on Package | fallback | unsupported | bare round trip |
| 97 | Set Zoom Level | case | case | bare round trip |
| 98 | Copy All Records/Requests | case | case | bare round trip |
| 99 | Go to Portal Row | case | case | bare round trip |
| 101 | Copy Record/Request | fallback | case | bare round trip |
| 102 | Flush Cache to Disk | fallback | case | bare round trip |
| 103 | Exit Script | case | case | bare round trip |
| 104 | Delete Portal Row | fallback | case | bare round trip |
| 105 | Open Settings | fallback | case | bare round trip |
| 106 | Correct Word | fallback | unsupported | bare round trip |
| 107 | Spelling Options | fallback | unsupported | bare round trip |
| 108 | Select Dictionaries | fallback | unsupported | bare round trip |
| 109 | Edit User Dictionary | fallback | case | bare round trip |
| 111 | Open URL | case | case | bare round trip |
| 112 | Open Manage Value Lists | fallback | case | bare round trip |
| 113 | Open Sharing | fallback | case | bare round trip |
| 114 | Open File Options | fallback | case | bare round trip |
| 115 | Allow Formatting Bar | fallback | case | bare round trip |
| 116 | Set Next Serial Value | case | case | bare round trip |
| 117 | Execute SQL | case | case | bare round trip |
| 118 | Open Hosts | fallback | case | bare round trip |
| 119 | Move/Resize Window | case | case | bare round trip |
| 120 | Arrange All Windows | fallback | case | bare round trip |
| 121 | Close Window | fallback | case | bare round trip |
| 122 | New Window | case | case | bare round trip |
| 123 | Select Window | case | case | bare round trip |
| 124 | Set Window Title | fallback | case | bare round trip |
| 125 | Else If | case | case | bare round trip |
| 126 | Constrain Found Set | case | case | bare round trip |
| 127 | Extend Found Set | case | case | bare round trip |
| 128 | Perform Find/Replace | fallback | case | bare round trip |
| 129 | Open Find/Replace | fallback | case | bare round trip |
| 130 | Set Selection | case | case | bare round trip |
| 131 | Insert File | case | case | bare round trip |
| 132 | Export Field Contents | case | case | bare round trip |
| 133 | Open Record/Request | fallback | case | bare round trip |
| 134 | Add Account | fallback | case | bare round trip |
| 135 | Delete Account | case | case | bare round trip |
| 136 | Reset Account Password | case | case | bare round trip |
| 137 | Enable Account | case | case | bare round trip |
| 138 | Re-Login | case | case | bare round trip |
| 139 | Convert File | fallback | unsupported | bare round trip |
| 140 | Open Manage Data Sources | fallback | case | bare round trip |
| 141 | Set Variable | case | case | bare round trip |
| 142 | Install Menu Set | case | case | bare round trip |
| 143 | Save Records as Excel | fallback | case | bare round trip |
| 144 | Save Records as PDF | case | case | bare round trip |
| 145 | Go to Object | case | case | bare round trip |
| 146 | Set Web Viewer | case | case | bare round trip |
| 147 | Set Field By Name | case | case | bare round trip |
| 148 | Install OnTimer Script | case | case | bare round trip |
| 149 | Open Edit Saved Finds | fallback | case | bare round trip |
| 150 | Perform Quick Find | case | case | bare round trip |
| 151 | Open Manage Layouts | fallback | case | bare round trip |
| 152 | Save Records as Snapshot Link | case | case | bare round trip |
| 154 | Sort Records by Field | case | case | bare round trip |
| 155 | Find Matching Records | fallback | case | bare round trip |
| 156 | Open Manage Containers | fallback | case | bare round trip |
| 157 | Install Plug-In File | case | case | bare round trip |
| 158 | Insert PDF | fallback | case | bare round trip |
| 159 | Insert Audio/Video | fallback | case | bare round trip |
| 160 | Insert from URL | case | case | Select option round trip |
| 161 | Insert from Device | fallback | case | bare round trip |
| 164 | Perform Script on Server | case | case | bare round trip |
| 165 | Open Manage Themes | fallback | case | bare round trip |
| 166 | Show/Hide Menubar | case | case | bare round trip |
| 167 | Refresh Object | case | case | bare round trip |
| 168 | Set Layout Object Animation | fallback | case | bare round trip |
| 169 | Close Popover | fallback | case | bare round trip |
| 172 | Open Upload to Host | fallback | case | bare round trip |
| 174 | Enable Touch Keyboard | fallback | case | bare round trip |
| 175 | Perform JavaScript in Web Viewer | fallback | case | bare round trip |
| 177 | AVPlayer Play | fallback | unsupported | bare round trip |
| 178 | AVPlayer Set Playback State | fallback | unsupported | bare round trip |
| 179 | AVPlayer Set Options | fallback | unsupported | bare round trip |
| 180 | Refresh Portal | case | case | bare round trip |
| 181 | Get Folder Path | fallback | case | bare round trip |
| 182 | Truncate Table | case | case | bare round trip |
| 183 | Open Favorites | fallback | case | bare round trip |
| 185 | Configure Region Monitor Script | fallback | unsupported | bare round trip |
| 187 | Configure Local Notification | fallback | unsupported | bare round trip |
| 188 | Get File Exists | case | case | bare round trip |
| 189 | Get File Size | case | case | bare round trip |
| 190 | Create Data File | case | case | bare round trip |
| 191 | Open Data File | case | case | bare round trip |
| 192 | Write to Data File | case | case | bare round trip |
| 193 | Read from Data File | case | case | bare round trip |
| 194 | Get Data File Position | case | case | bare round trip |
| 195 | Set Data File Position | case | case | bare round trip |
| 196 | Close Data File | case | case | bare round trip |
| 197 | Delete File | case | case | bare round trip |
| 199 | Rename File | case | case | bare round trip |
| 200 | Set Error Logging | fallback | case | bare round trip |
| 201 | Configure NFC Reading | fallback | unsupported | bare round trip |
| 202 | Configure Machine Learning Model | fallback | case | bare round trip |
| 203 | Execute FileMaker Data API | fallback | case | Select option round trip |
| 205 | Open Transaction | case | case | bare round trip |
| 206 | Commit Transaction | fallback | case | bare round trip |
| 207 | Revert Transaction | case | case | bare round trip |
| 208 | Set Session Identifier | fallback | case | bare round trip |
| 209 | Set Dictionary | fallback | case | bare round trip |
| 210 | Perform Script on Server with Callback | fallback | case | bare round trip |
| 211 | Trigger Claris Connect Flow | fallback | unsupported | bare round trip |
| 212 | Configure AI Account | case | case | bare round trip |
| 213 | Fine-Tune Model | fallback | unsupported | bare round trip |
| 214 | Perform SQL Query by Natural Language | fallback | case | bare round trip |
| 215 | Insert Embedding | case | case | bare round trip |
| 216 | Insert Embedding in Found Set | case | case | bare round trip |
| 217 | Set AI Call Logging | fallback | case | bare round trip |
| 218 | Perform Semantic Find | case | case | bare round trip |
| 219 | Perform RAG Action | case | case | bare round trip |
| 220 | Generate Response from Model | case | case | bare round trip |
| 221 | Perform Find by Natural Language | case | case | bare round trip |
| 222 | Configure Regression Model | fallback | unsupported | bare round trip |
| 223 | Set Revert Transaction on Error | case | case | bare round trip |
| 225 | Save Records as JSONL | fallback | case | bare round trip |
| 226 | Configure Prompt Template | case | case | bare round trip |
| 227 | Configure RAG Account | fallback | case | bare round trip |
| 228 | Go to List of Records | fallback | case | bare round trip |
| 237 | Flush Web Viewer Cookies | fallback | case | bare round trip |
| 238 | Configure Persistent Data | fallback | case | bare round trip |
| 240 | Insert Image Captions in Found Set | fallback | unsupported | bare round trip |
| 241 | Insert Image Caption | fallback | unsupported | bare round trip |
| 242 | Print PDF | fallback | case | bare round trip |
| 243 | Create PDF | fallback | case | bare round trip |
| 244 | Append PDF | fallback | case | bare round trip |
| 245 | Close PDF | fallback | case | bare round trip |
| 246 | Open PDF | fallback | case | bare round trip |
| 247 | Cancel PDF | fallback | case | bare round trip |
