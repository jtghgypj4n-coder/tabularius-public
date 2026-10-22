# Tabularius

An open-source (MIT licence), AI-native platform for FileMaker solutions: open an existing
`.fmp12` file, host it, and work with it from a modern client, with an MCP
server built in.

**Just want to see it?** On macOS or Linux, one command installs the single-file program (no Node
needed), and `tabularius demo` hosts a sample app on this computer only:

<!-- docs-example: illustrative -->
```sh
curl -fsSL https://github.com/sitotisai/tabularius/releases/latest/download/get.sh | sh
tabularius demo
```

The demo opens in your browser with a one-time password for `Admin`, and deletes everything
when you press Ctrl-C. To host your own FileMaker file, see [QUICKSTART.md](QUICKSTART.md).

**Status:** early, working end to end for data:

- **Reader**: decodes tables, fields, table occurrences, layouts, scripts,
  value lists, custom functions, accounts, privilege sets, relationships,
  records and embedded container files (images, PDFs) from unencrypted
  `.fmp12` files.
- **Hosting**: point the server at a folder of `.fmp12` files. Each is
  converted once into its own SQLite database and hosted under its file name.
- **FileMaker Data API–compatible REST**: sessions, layouts, records, finds
  with FileMaker find syntax, create/edit/duplicate/delete, modId conflict
  checks, portals with portalDataInfo, global fields, script and layout
  lists in their folders, container fields as download URLs, and container
  uploads. A conformance suite checks the responses, types, HTTP statuses
  and error codes against Claris's Data API guide;
  [docs/data-api-compatibility.md](docs/data-api-compatibility.md) lists
  every endpoint, field, header and error code as supported, partial or missing.
  [docs/known-differences.md](docs/known-differences.md) is the one list of
  everything that differs from FileMaker or isn't settled yet.
  [docs/for-filemaker-developers.md](docs/for-filemaker-developers.md) maps each
  FileMaker menu path and tool to where it is here.
- **Calculations** ([packages/calc](packages/calc/README.md)): FileMaker
  formulas run live. Unstored calculations are computed when read (through
  related records, globals and custom functions); stored calculations and
  auto-enter options (stamps, serials, constants, formulas) are applied on
  create and edit; validation (not empty, unique, range, value list, maximum
  length, formula) rejects bad writes with the Data API's error codes.
  Custom functions can also be written in JavaScript (Design > Functions >
  Written in), for what calculations do badly: regular expressions, parsing,
  hashing. Calculations call them like any custom function. Each call runs in
  a separate sandbox process with no files, network, modules or environment,
  in a fresh realm that keeps nothing between calls, for up to 1 second and
  64 MB, returning at most a million characters; past any limit it gives "?".
  FileMaker Pro can't run them, so copying one for FileMaker leaves it out.
- **MCP server** (HTTP and stdio): AI assistants can explore schema, read
  scripts, find and edit records, evaluate formulas, view container images,
  run read-only SQL, and run scripts. They can also understand a solution:
  `explain_solution` maps tables, relationships, script call graphs and the
  scripts that reach outside (mail, network, plug-ins); `document_solution`
  writes the whole design out as documentation (every table and field, the
  relationships, each layout and the scripts it starts, each script with its
  header comment, what starts it and what it calls), also downloadable as a
  web page or Markdown from Design > Report's "Document this solution", where
  the assistant can write an introduction to put first. Beyond reading, an
  AI client can do what a person does in the web client, within its
  account's privileges: edit portal rows (`update_record`), put files in
  containers (`upload_container`), change single layout objects and
  triggers (`edit_layout_objects`), debug a script with breakpoints and watch
  formulas (`debug_script`, offline), try design changes on a throwaway copy
  before applying them (`try_design_change`), paste or copy FileMaker
  clipboard XML (`paste_from_filemaker`, `copy_for_filemaker`), manage the
  image library, and edit accounts and privilege sets (`change_security`;
  never passwords). `where_used` and
  `search_solution` work across every formula, script step and layout object;
  `check_change_impact` says, before a field, table, layout, script or value
  list is renamed or deleted, what would break: names inside quotes (GetField,
  ExecuteSQL, Evaluate, steps "by name") that a rename doesn't reach,
  privilege set entries and record limits (kept by name), and Data API clients
  seen calling it in the last 30 days (Design mode shows the same, and asks
  before a rename or delete that breaks something);
  `suggest_rules` reads a table's records for rules they already follow (a
  field that only holds a handful of values becomes a value list to check
  against, an id that differs on every record becomes unique and required, a
  number counting up becomes a serial, a value nearly every record has becomes
  a default), each with the change that adds it; Design mode lists them under
  each table to accept one at a time;
  `describe_layout` profiles a layout's fields and data so a plain-English
  request becomes a find; `check_calculation` checks a drafted formula (unknown
  names with "did you mean", parameter counts, sample results, and warnings
  for what FileMaker accepts silently); `explain_value` shows why a field holds
  its value on a record (the formula, every value it read, each evaluation
  step, the calculations behind it); `explain_related` says why a portal or
  related field shows what it does, or nothing (the relationship path, each
  match field's values on both sides, the portal filter and sort, every related
  record in or out and why, and "why isn't record N here?"); `lint_formulas` lists those warnings for a
  whole file; `find_stale_calcs` counts, per field, the stored calculations whose
  saved value has fallen behind their formula (a stored calculation that reads other
  records with ExecuteSQL can fall behind when they change), and `refresh_stale_calcs` brings chosen ones
  up to date as one logged batch that `undo_stale_refresh` takes back (converted
  files keep FileMaker's stored values until then; also `tabularius stale-calcs`); and
  `check_script` a drafted script (steps, If/Loop structure, layouts, scripts,
  fields, formulas, unset variables, outbound steps) without running it;
  `compare_solutions` says what changed between two versions of a file, and
  `conversion_report` (also `tabularius report <folder>`, and the Report tab in
  design mode) lists what in a file won't work yet; `conversion_guide` is the
  plain-English version written when a file is converted or converted again
  (what won't work until changed, what works differently, such as Send Mail,
  Insert from URL and web viewers that load internet pages, and the built-in
  replacement for each, with the assistant's overview on top when it is on;
  secrets in scripts are hidden), also under Guide in the admin console's
  Hosted files; `optimization_report` (also `tabularius optimize`, and Optimize
  there) says what would make a file smaller or faster, worst first: container
  files kept inside it (for S3 or external storage instead), sorts no index
  serves, things nothing uses; it changes nothing. Prompts
  `explain_solution`, `find_in_plain_english`, `draft_calculation`,
  `draft_script`, `review_security` and `who_changed` package these for MCP
  clients that show prompts.
- **Scripts** ([packages/scripts](packages/scripts/README.md)): FileMaker
  scripts run on the server, the way FileMaker Server runs them: by name over
  REST, as Data API script triggers (`script`, `script.prerequest`,
  `script.presort`), and from MCP. The web client's **Debug Scripts** opens a
  script debugger like FileMaker Pro's (step into, over and out, breakpoints,
  variables and a Data Viewer) for full-access accounts. By default it runs on
  a throwaway copy of the file, offline (**Scratch copy**, an option the Script Debugger in
  [Claris's help](https://help.claris.com/en/pro-help/content/debugging-scripts.html) doesn't list), so stepping through a script that deletes or changes records
  leaves the hosted file as it was; untick it to debug on the hosted file
  (REST `"scratch": false`, MCP `debug_script` `scratch: false`). **Record
  run** (time travel; Claris's debugger page lists no way to step back) runs the whole script on a scratch
  copy, then steps backwards and forwards through it: each step's call stack,
  variables, found set, and what it did to records (Set Field values before
  they are saved too), with a jump to every step where a chosen field changed.
  It records up to 5,000 steps. Its **Data Viewer**
  button opens one without running a script: watch expressions follow the
  record the web client shows, and a Current tab lists that record's fields
  and the session's $$variables. With the AI assistant on, **Draft with AI**
  there writes an expression from words (checked against the layout's table,
  then Use puts it in the box) and **Explain with AI** says what one works out
  on that record.
- **Several people at once**: typing in a record locks it, as in FileMaker;
  anyone else who tries to change it is told who has it (error 301), over
  the web client, Data API, scripts and MCP alike. Changes show up live in
  everyone's windows. Daily online backups, and a one-command install as a
  service or in Docker.
- **Web client**: open a hosted file in the browser and use its layouts, drawn
  from the file's own design ([docs/web-client.md](docs/web-client.md) says what
  Browse, Find and Preview do and don't yet): theme styles, fields, value lists, portals, tab and
  slide controls, popovers, button icons, hide conditions, conditional
  formatting, number, date and time formats, tooltips and placeholders. Form,
  list and table view (each layout opens in the view saved in the file), with
  sub-summary groups and subtotals when the list is
  sorted by their break field; browse, find, quick find, sort by one or
  several fields, new/edit/delete records and portal rows, drag a file onto a
  container field. Script buttons run their scripts on the server (with the
  button's parameter) and the window follows: layout, found set, record and
  mode. A script's Insert File asks for the file in the browser.
  Install OnTimer Script gives the window a timer that runs its script every
  so often, with the parameter worked out each time. The timer waits while a
  script runs or the cursor is in a field, and stops on an Install OnTimer
  Script with no script. The browser only gets an id for the timer, so it
  can't run any other script that way. Perform JavaScript in Web Viewer calls
  the named web viewer's function with the parameters as text, and the script
  goes on once the function has been called, not when an async function finishes.
  Web viewers
  keep their page across redraws (in browsers with `Element.moveBefore`).
- **Import with matching**: Import Records in the web client matches a CSV or
  Excel file's columns to the layout's fields by name and by their values (by
  the assistant with **Match with AI**), with fixes for each column (day-first
  dates, `$1,200.00`, yes/no, value list spellings, Excel dates), a preview, and
  the rows already in the file or repeated, by an email or id. The import is one
  step that **Undo** takes back (records changed since are kept). MCP clients get
  plan_import, import_records and undo_import.
- **Record search**: `search_records` (MCP and the assistant) finds records by
  words in any table or field, ranked, with a full-text index on the server
  (no outside service), within the account's privileges. `summarize_records`
  gives counts, totals and breakdowns of a found set ("open invoices per
  customer with their total") without reading every record.
- **AI assistant** in the web client and design mode (`tabularius serve --ai`,
  with an Anthropic API key in `ANTHROPIC_API_KEY`, or in the file
  `~/.openhbam/anthropic-key` (chmod 600; `--ai-key-file` to move it), which is
  how a boot service gets one; the file is read again when it changes; a key made outside a workspace
  also needs `--ai-workspace-id wrkspc_…` or the file
  `~/.openhbam/anthropic-workspace-id`; /admin checks the key with the provider
  and shows AI: connected, no key, key needs a workspace, or credit too low): ask about the file, the
  layout or the record in front of you, have a calculation or script
  explained, or have one drafted. Ask it to "show me" records and it runs the
  find and offers a button that opens them in the window; in Find mode,
  "Find with AI" takes a description ("customers in Ohio who haven't
  ordered since June") and fills in the find requests it means, omit
  requests included, in the Find mode form, to check and change before
  you click Perform Find. A find made this way is named by your words in
  recent and saved finds. The requests are also listed in the panel, where
  you can change any criterion and find again, or open them in Find mode;
  the find always runs as your account. Ask for a chart ("members
  by state", "sales per month") and it draws one in the panel, with the
  numbers worked out from the data the account may see. Ask for a dashboard
  ("revenue by month for my top 10 customers this year") and it builds
  charts, a summary table and totals with a Save button; saved dashboards
  open from the toolbar's Dashboards button, refresh live, keep relative
  dates relative ("this year" stays this year), show the find and grouping
  each widget uses, and let you change them. Each account sees the numbers
  for the records it may view. MCP clients get list_dashboards,
  get_dashboard and save_dashboard. Under a dashboard, set up a digest
  ("Mondays at 08:00, summarise new and overdue invoices"): at that time
  the server works the dashboard out as your account and the assistant
  writes a short summary of it, offline, with secrets hidden. Each run is
  kept with the file and shown under the dashboard, as a notice in the web
  client when it is new, and in the admin console's AI digests list.
  Nothing is emailed; someone with [Full Access] can also have each run
  posted to one of the admin console's webhooks, sent only on a server
  started with --allow-webhooks. Ask it to clean up your data ("find
  duplicate customers") and it lists likely duplicates (the same email or
  phone, names nearly alike at the same address), values off their value
  list ("Actve" for "Active") and malformed phone numbers and emails, with
  suggested fixes to tick; nothing changes until you click Apply. A merge
  keeps one record, fills in its empty fields from the others and moves
  their related records to it. Each batch applies all or none, as your
  account, lands in the audit log, and can be undone. The toolbar's Clean
  Up Data page does the same without the assistant; MCP clients get
  find_data_problems, fix_data_problems and undo_data_fix, and update_records
  sets the same fields on up to 1,000 records a find gives (preview first, all
  or none, undone the same way). Describe an
  automation ("when an invoice is marked paid, set the paid date and add a
  note to the customer") and someone with [Full Access] gets a trigger and
  a script to review, already tried out offline on a copy of the file, with
  the changes it made there listed; nothing runs on the real file until you
  click Turn on. Automations run as the account you pick, never re-trigger
  themselves, keep a log of their recent runs, and leave mail and web steps
  off unless the server's outbound settings allow them. One can also run
  when a record is deleted (none of FileMaker Pro's
  [layout script triggers](https://help.claris.com/en/pro-help/content/layout-script-triggers.html) fires on a delete): the script gets
  the deleted record as JSON in Get ( ScriptParameter ). A capture-only
  file never has automations. The toolbar's
  Automations page lists, pauses and deletes them; MCP clients get
  list_automations, try_automation, save_automation and delete_automation.
  When a script stops with an error in the web client, the message has a
  "Why?" button (for accounts that may see scripts' steps, as in the
  Script Debugger): the assistant runs the script again on a throwaway
  copy of the file, offline, finds the step that failed, and explains it
  with the variables and field values there; a fix to the script comes as
  the changed steps, with a dry run, to apply or not. `tabularius
  test-scripts --explain` prints the same for each script that ends with
  an error, without AI; MCP clients get explain_script_failure.
  For someone with [Full Access], "What changed on this record, who changed
  it, and why?" reads the record's audit trail as events (who, when, each
  field from and to) and says how each change came about where the file can
  tell: worked out by an auto-enter calculation from another field changed
  then, stamped, looked up, or made by an automation or a data cleanup, with
  what the same person changed in other tables at that moment. MCP clients get
  explain_record_history.
  "Ask about this record" (a toolbar button in Browse mode) summarizes the
  record in front of you with what hangs off it (its orders, notes, line
  items), then answers questions about it; each fact is marked with the
  field it came from, and a related record's id. It reads only the records
  and fields your account may see, and leaves out calculations that total
  records you can't view; MCP clients get describe_record.
  It uses the MCP tools as the signed-in
  account (its privilege set applies; it needs the fmmcp extended
  privilege), reads only, and never runs scripts on the live file. Design changes it drafts
  show up with an Apply button for someone with [Full Access]. In design
  mode, "Draft with AI" beside a formula box (calculation, auto-enter or
  validation), a custom function or the script editor writes one from a
  sentence, checks it against the solution, and offers a button that
  puts it in the editor for you to review and save. Under a field's formula
  box, a live preview works the formula out as you type, on the record you
  were on when you opened design mode and a few others; when Check syntax finds an error, "Fix with AI"
  beside it drafts the corrected formula the same way. In the script editor,
  a drafted script first shows as the lines it adds and removes, to put in
  the editor or discard, and **Why does it fail?** runs the script again on a
  throwaway copy, offline, from the layout and record you came from, and says
  which step stops it and how to fix it. The script editor also checks the
  script as you type: loops that can't end and
  guards that catch nothing show under it with a fix, **Why?** says where a
  count comes from and when it is 0 (a parameter the script never got, a
  record with no related rows), and **Fix with AI** drafts the change as a
  diff to review. When a running loop does go on and on, it stops with the
  loop's line and the linter's reason (`--loop-limit` and `--loop-records`
  on `tabularius test-scripts` set how many passes or new records a loop may
  have; a loop that adds 100,000 records stops by default). The linter also
  flags a loop whose Exit Loop If reads only variables the loop never
  changes. **Runaway guard** in the script editor gives one script its own
  limits (steps, seconds not counting waits for a person, times round a
  loop): past any of them it stops cleanly however it is run, subscripts
  included. **Tests** in the
  script editor keep test cases with the file:
  a case's inputs (parameter, layout, found set, current record, global
  variables and fields, and answers for AI steps instead of a model) and what
  the script should end with (result, error, found count, layout, global
  variables, the ending record's fields). "Fill in from a run" records how a
  run ends. Cases run offline on a copy of the file, so hosted data never
  changes; `tabularius script-tests <folder>` runs them all and exits 1 when one
  fails, for CI. **History** lists each save of the script here, shows what
  each changed, and can put an earlier version back in the editor. **Profile**
  shows each step's own time a run beside its line, with × how many times a
  run a loop's steps ran, and picks out the slowest steps: from the script's
  runs on the server, or from one run now, offline on a copy. **Dry run** runs
  the script once on a throwaway copy, offline, and lists each record it would
  create, change or delete, every field with its value before and after.
  **Improve** lists where the script could be simpler or faster: branches that
  never run, steps nothing reaches, runs of steps written twice (one subscript
  instead), the whole of another script written out again, a loop setting a
  field a record at a time (Replace Field Contents instead), a find or commit on
  every pass, and the steps the profiler says take the time. **Refactor with
  AI** hands those to the assistant (when the file allows AI); its draft shows
  as a diff with its own **Dry run**, and nothing changes until you put it in
  the editor and save. A drafted script is
  also test run once on a throwaway copy of the file, offline (no
  network, mail or plug-ins), and the card says how it went: the steps
  it ran, or the error or endless loop it hit, which the assistant fixes
  before offering it. Files over 200 MB skip the test run. Design changes
  it proposes that write scripts get the same test run, on a copy with all
  the proposed changes applied. In Design > Report, "Propose fixes with AI"
  goes through what didn't convert (missing functions, plug-ins, steps that
  can't run, email, the network, tables in files not hosted here) and
  proposes tabularius-native replacements to review and apply, and each item
  has its own Ask AI button. "Design with AI"
  under the tables, layouts, scripts, value lists and custom functions
  lists turns a sentence ("invoices with line
  items") into a proposed design change, applied only when you say so, and
  "Change with AI" in the layout editor does the same for the open layout
  ("put the address fields in two columns"). Off unless
  started with `--ai`: questions and what the tools read go to the model
  provider. Answers stream in as they are written, and Stop ends one
  (the server stops calling the model). When the model provider is busy
  or rate limited, a call is tried again twice before the answer fails. Only the latest part of a long chat
  (20 messages) is sent with each question. Prompts are cached
  between tool steps to keep API costs down,
  and each answer shows the tokens it used. `--ai-daily-tokens 2000000` caps
  what the assistant may use per day (cached input counts at a tenth, as it
  is billed); past it, questions wait until the next day (UTC).
  `--ai-account-daily-tokens 200000` does the same per account, and shows
  each person their own usage. The count is
  kept in `<folder>/.openhbam-ai-usage.sqlite`, shared by every worker
  (`--workers`), so the limits and the monthly budget hold for the whole
  server, and a restart doesn't reset them.
  Simple questions (reading, finding, adding up) go to a fast model at low
  effort (`--ai-fast-model`, default `claude-haiku-5-5`; `off` sends
  everything to the main model); design work, drafts, scripts and security
  go to `--ai-model` (default `claude-opus-5-5`). Anthropic has no embeddings
  API, so script embeddings (Insert Embedding, Insert Embedding in Found Set,
  GetEmbedding, Perform Semantic Find by natural language) use a separate
  model: `--ai-embed-url` (any OpenAI-compatible `/embeddings` endpoint: OpenAI,
  Ollama, LM Studio, vLLM ...) with `--ai-embed-model`, and the key, if it needs
  one, in `TABULARIUS_AI_EMBED_KEY`. `--ai-embed-url ollama` or `lmstudio` is enough
  for a model on this computer (see docs/local-embeddings.md), and works without
  `--ai` or an Anthropic key; `tabularius doctor --ai-embed-url ollama` checks the
  model answers. Without an embedding model those steps stop with error 3.
  The same model feeds Configure RAG Account and Perform RAG Action (add data,
  send prompt, remove data): spaces live in `.openhbam-rag.sqlite` in the server's
  folder, one set per file, searched without an index but with the vectors kept in memory (up to
  50,000 chunks a space, about 70 ms a search at 768 dimensions).
  Each question starts with
  a short outline of the file and the dozen tools most questions need; the
  rest are deferred, and the model finds them with Anthropic's tool search
  when a question calls for them. The admin console's **AI use** section
  lists the latest questions with their model, time, tokens and approximate
  cost (list prices), and the month's total; `--ai-monthly-budget 150` stops
  questions once the month reaches about $150. Without `accept:
  application/x-ndjson`, the assistant's API answers with one JSON object
  whose `reply` is the answer's text (with `model`, `ms` and `usage`).
- **[AI-visible policy, per file](docs/ai-visible-policy.md)**: new solutions default on; existing and converted files stay off until an administrator opts in. Secret-bearing sources need explicit privilege-set exceptions, and uncertain script/SQL reads are refused. See the [implementation and test report](docs/ai-visible-policy-report.md).
- **AI off, per file**: the admin console's Hosted files table shows whether AI
  can read each file and turns it off (or `tabularius ai <folder> <file> off`, or
  `serve --ai-exclude A,B`). A file with AI off is never read for AI apps (MCP),
  the assistant, digests' summaries or AI matching, for any account, the local
  administrator included; a file that uses its tables is kept from AI too. Turning
  it off or on, and every refused AI request, is in the file's security log.
- **FileMaker's AI script steps** run on the same model: Configure AI Account,
  Generate Response from Model (with its message history), Perform Find by
  Natural Language (the model sees field names, never record data), Configure
  Prompt Template, and Perform Semantic Find by vector data. The API key and
  endpoint a script configures are never read; this server's model answers,
  under the same daily limits and per-file AI switch. Without `--ai`, in
  `test-scripts`, in automations (AI apps can save those) and in scripts an AI
  app runs, these steps stop with error 3
  and say why. A capture-only file (see outbound test mode) never reaches
  AI. Insert Embedding and Perform Semantic Find by natural language need an
  embedding model, which Tabularius doesn't offer yet.

Not yet: containers in FileMaker's secure (encrypted) external storage. See <!-- known-difference: Reading .fmp12 files ;; Containers in FileMaker's secure (encrypted) external storage are not supported ;; Such containers do not come across from a converted file ;; An owner decision on supporting them, and a sample file that has them -->
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What does not carry over

Read this before moving a file. Each point is detailed in
[docs/moving-a-solution.md](docs/moving-a-solution.md) and, with what is still
unknown, in [docs/known-differences.md](docs/known-differences.md).

- **People use a browser.** There is no FileMaker Pro or FileMaker Go client for a file hosted here.
- **Passwords.** An account whose FileMaker password is empty keeps working, from the server's own computer. Every other account needs a new password set with `tabularius passwd`.
- **Plug-ins are never loaded.** A few BaseElements and MBS functions run as built-in code; any other plug-in call gives "?" and error 3.
- **Scripts run on the server, offline.** Mail is never sent and web requests stay off unless the server is started to allow them; steps that need a screen or a person at FileMaker Pro are skipped or give error 3.
- **The store is not the `.fmp12`.** A converted file lives in an SQLite store beside the original, which is left as it was; changes made here can't be written back into a `.fmp12`.
- **Some security detail is flattened.** Per-layout, per-value-list and per-script privileges come over at the privilege set's overall level; review your sets in Manage Security before people sign in.

## Try it

**New here?** [QUICKSTART.md](QUICKSTART.md) gets a FileMaker file hosted and
open in your browser in a few minutes: run `tabularius`, then drop the file on
the page.

Browse the [documentation index](docs/README.md) for all guides and references,
or the [examples index](examples/README.md) for apps and plug-ins to build on.

Needs Node 22.20 or newer. No install step for the reader itself.

`tabularius version` prints the version, the commit and the Node it needs
([what a version number means](docs/versioning.md)), and `tabularius help [command]` (or
`--help` after any command) lists the commands or shows one command's usage.
The options of `serve` can also be set in the environment: see
[environment variables](docs/environment-variables.md).

<!-- docs-example: illustrative -->
```sh
npm install            # TypeScript types, plus the server's two packages (see below)
npm run fixtures       # download public sample files
npm test
npm run converter-quality  # lists layout objects of the sample files that did not convert (--strict fails on an error; give .fmp12 files to check your own)
npm run smoke:web      # optional: load /admin and /app in a real browser and fail on any JS error
npm run smoke:sync     # optional: drive the admin console's Sync page in a real browser against a stand-in Data API
npm run visual         # optional: draw every sample layout in a real browser and fail if one draws differently from the baseline (--update to accept)
                       # (needs a Chromium; one is preinstalled in cloud sessions, or set TABULARIUS_CHROMIUM)
npm run test:e2e       # the web client in a real browser through Playwright: open a file, find, edit,
                       # sort, portals and record locking (packages/web/e2e; same Chromium as smoke:web)

npm run tabularius -- info    fixtures/fmp12/Charts.fmp12
npm run tabularius -- schema  fixtures/fmp12/FMburgh_2012_11_07_Database.fmp12
npm run tabularius -- records fixtures/fmp12/Charts.fmp12 "NW Customers" --limit 5
npm run tabularius -- export  fixtures/fmp12/Charts.fmp12 charts.sqlite
npm run tabularius -- dump    fixtures/fmp12/Standards.fmp12 --prefix 17.5 --text
```

The reader, store, calculation and script engines and web client use
nothing beyond Node. The server uses two packages: the official MCP SDK
(`@modelcontextprotocol/sdk`), which serves `/mcp` and `tabularius mcp`, and
`zod`, which describes the MCP tools' inputs. The SDK brings its own
dependencies with it. The single-file program and the Docker image include
them, so neither needs an install step.

The AI tools have an eval suite (`packages/server/evals/`): plain-English
finds, formula and script drafts, rename impact checks and suggested rules
on the Charts sample (and finds on Flicks, a differently built file), each graded against the file's own data (the records a
find should show, a formula's result on every record, the found set a
script ends on), plus a cost case: "what is this file about?" must go to
the fast model in at most two calls of at most 6,000 tokens each (and, live,
answer within 15 seconds). `npm run evals` replays recorded answers, so it costs
nothing and runs inside `npm test`. `npm run evals -- --live` asks the real
model (key from `ANTHROPIC_API_KEY` or `~/.openhbam/anthropic-key`), and
`--live --record` saves its answers as the new recordings. Scripts run
offline, on a throwaway copy of the file.

`npm run eval:ai` is the live run (it uses the API key, so it is never part of
`npm test` or the automatic test runs). To judge a model or routing change by
numbers, compare models side by side:

```sh
npm run eval:ai -- --models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5,routed
```

Each model answers every call of every case ("routed" is the server's own
choice between its main and fast models). The table shows cases and checks
passed, tokens, cost at list prices, the median and slowest answer time, and
the cases where the models differ.

Host a folder of files:

<!-- docs-example: illustrative -->
```sh
npm run tabularius -- serve ~/FileMakerFiles --port 8080
echo 'new-password' | npm run tabularius -- passwd ~/FileMakerFiles Contacts Admin

curl -X POST -u Admin:new-password http://127.0.0.1:8080/fmi/data/vLatest/databases/Contacts/sessions
```

Then open http://127.0.0.1:8080/ in a browser, type the file's name (or pick it, on a server started with `--list-files-publicly`) and log in with
that account to use the web client.

To call the Data API from your own code, follow
[Add a Data API client in 10 minutes](docs/tutorials/data-api-client.md).

To compare stored calculations with recomputed results, run
`npm run tabularius -- fidelity ~/FileMakerFiles Contacts`. It reports counts
and differences without showing values, changing data or running scripts;
`--sql` limits it to calculations using ExecuteSQL, `--n` sets the per-field
sample limit (200 by default), and `--json` prints JSON.

Imported FileMaker accounts keep their names. An account whose FileMaker
password is empty (like many files' Admin) signs in with that empty password,
but only from the server's own computer; start the server with
`--allow-blank-passwords` to let other computers in too, and the server lists
such accounts when it starts. Other accounts need a new password set with
`tabularius passwd`: we can't check FileMaker's non-empty passwords yet.

Accounts keep their privilege sets, and every way in enforces them: records
an account can't view are left out of found sets, fields it can't see are
omitted, and writes it isn't allowed fail with FileMaker's errors (200, 201).
Each set's overall access comes over from the file, and so do its
exporting, password-change and idle-disconnect options and its printing
option (which stops the Print and Save Records as PDF steps; a browser can
always print the page it shows). Of FileMaker's **Custom privileges**,
per-table and per-field record access come over failing closed: a table the
set doesn't list gets no access, and in a table whose fields the set
customises, a field the file doesn't mark read/write is hidden until you
grant it. Per-layout, per-value-list and per-script access don't yet (they
come over at the set's overall level, or with no access where the file
stores them in a form no sample shows), the menu command option comes over
as All, and record access limited by a calculation isn't read from the file
yet: no sample file has one, and a record-access value no sample shows comes
over as view only at most. Review your own sets in Manage Security before people
sign in.
As on FileMaker Server, the Data API needs the `fmrest` extended privilege; the
web client needs `fmapp` or `fmwebdirect`; AI clients signed in with an
account need `fmmcp` (new; `[Full Access]` has it). A file's own `[Full Access]`
often lacks them (in the sample files Charts has neither `fmapp` nor `fmrest`,
and Flicks has `fmapp` only), so when a file is first opened here its
`[Full Access]` gets `fmapp` and `fmrest`, and the file's administrator can sign
in straight away.
Grant or revoke them, and set up other sets, with:

<!-- docs-example: illustrative -->
```sh
npm run tabularius -- privileges ~/FileMakerFiles Contacts                 # accounts and sets
npm run tabularius -- privileges ~/FileMakerFiles Contacts grant "[Full Access]" fmrest
npm run tabularius -- privileges ~/FileMakerFiles Contacts show "[Data Entry Only]" > set.json
npm run tabularius -- privileges ~/FileMakerFiles Contacts save set.json  # custom sets, per table/field/layout/script
npm run tabularius -- privileges ~/FileMakerFiles Contacts account Clerk "Data Entry Only"
npm run tabularius -- privileges ~/FileMakerFiles Contacts policy 12 90  # minimum length; maximum age in days
npm run tabularius -- privileges ~/FileMakerFiles Contacts must-change Clerk
```

`account` assigns an account to a privilege set. `policy` with no numbers shows
the current minimum password length and maximum age; give a minimum length,
optionally followed by a maximum age in days, to set them, and use `0` to turn
a limit off. Until a file sets its own minimum, a new password needs at least 12
characters (as does the admin console's); `TABULARIUS_MIN_PASSWORD_LENGTH` sets
another default (`0` for none), and `policy 0` gives one file no minimum. `must-change` requires
the account to change its password at next sign-in; add `off` to clear that
requirement.

A custom set can limit records with a calculation, as FileMaker's "limited"
privileges do: `"tables": {"Invoices": {"view": "Owner = Get ( AccountName )",
"edit": "Status ≠ \"Paid\"", "create": true, "delete": false, "fields":
{"Cost": "none"}}}`. Scripts run within the account's privileges too: they find
only records it can view and change only what it may edit. A script set to "Run
script with full access privileges" in the file runs with full access, as in
FileMaker; its subscripts follow their own setting.

Or do all of this in the browser: the web client's **Manage Security** button
(full access only, like FileMaker's Manage Security) opens an area to add and
edit accounts, build privilege sets (record access per table with record-level
calculations, field, layout, value-list and script access, and extended
privileges), mint and revoke API tokens, and turn two-factor on or off — its
own area, next to Design.
With the AI assistant on, its **Ask AI** panel reviews the file's security
(accounts with no password, sets more open than they need to be, who can use
AI or the Data API) and **Explain with AI** on an account or privilege set says
what it allows. The assistant reads accounts and privilege sets with the
`get_security` tool ([Full Access] only; never passwords or token secrets) and
can't change them.

People can also sign in through an identity provider (any OpenID Connect
provider; the tests use a stand-in one and cover the verified-email rule, Apple's
signed client secret and Entra ID's tenant rules, but no named service is run live), as with
FileMaker's external accounts. Register Tabularius with the provider (redirect
URI `https://your.server/tabularius/auth/v1/oidc/callback`), then:

<!-- docs-example: illustrative -->
```sh
TABULARIUS_OIDC_CLIENT_SECRET=... npm run tabularius -- serve ~/FileMakerFiles \
  --public-url https://your.server --oidc-issuer https://login.example.com --oidc-client-id tabularius --oidc-name Microsoft
npm run tabularius -- privileges ~/FileMakerFiles Contacts external "Sales" "Data Entry"
npm run tabularius -- privileges ~/FileMakerFiles Contacts external pat@example.com "[Full Access]"
```

The web client then shows "Sign in with Microsoft". Someone the provider
vouches for gets the privilege set of the external account named their
(verified) email address, else of the first of their groups that has one. The
file's own external accounts count too. Groups come from the ID token's
`groups` claim (`--oidc-groups-claim` to change it); Entra ID sends group ids
there unless set to send names. Tabularius also accepts a configured top-level
claim such as `roles` or `wids`, an exact namespaced claim, or a dot path such
as `realm_access.roles`. An Entra group-overage marker refuses sign-in until
the provider sends a complete group list.

An email matches an account (its own, or one named for its domain, such as
`@example.com`) only when it can be trusted: the provider says it verified it
(Google and Apple do), or the issuer is one organisation's Entra ID tenant
(`https://login.microsoftonline.com/<tenant id>/v2.0`) and the person is one
of its members rather than a guest (a guest's address needs Entra's `xms_edov`
optional claim). For a company's own
provider that hands out only addresses it owns but doesn't say so,
`--oidc-trust-email` (or `"trustEmail": true` in `--oidc-config`) trusts its
emails too. Never use it with a provider where people can type any address.
Groups match either way, except a group with a `@` in its name, which never
matches (it could stand for an address).

Data API apps can sign people in through the same providers, the way
FileMaker Server's Data API guide describes ("Log in to a database session
using an OAuth identity provider"): `GET /fmws/oauthproviderinfo` lists the
providers, `GET /oauth/getoauthurl?trackingID=...&provider=...` with an
`X-FMS-Return-URL` header answers the provider's address to open and an
`X-FMS-Request-ID`, the person is sent back to the app's address with
`?trackingID=...&identifier=...`, and `POST .../sessions` with
`X-FM-Data-OAuth-Request-Id` and `X-FM-Data-OAuth-Identifier` logs in. The
identifier works once, within five minutes, and the person always picks
their account at the provider. People are sent back only to this server's
own address or to an app listed with `--oidc-data-api-return-urls
https://app.example.com,https://other.example.com/signed-in` (or
`"dataApiReturnUrls"` in `--oidc-config`), so a link someone else started
can't send them an identifier. An app on the person's own computer is listed
with its port (`http://127.0.0.1:5000`); it isn't allowed by default, since on
a shared machine such as a terminal server anyone could listen there.

An LDAP directory or Active Directory works the same way, for sites that
authenticate against one (tested against a stand-in directory that speaks the
protocol, not yet a live Active Directory <!-- known-difference: Privileges and security ;; LDAP sign-in is tested against a stand-in directory, not a live Active Directory ;; A directory with matching rules the stand-in lacks may behave differently ;; A run against a live directory -->). People type their directory username and password
into the ordinary sign-in; the server binds to the directory with them, and an
external account named their email or one of their groups gives the privilege
set. Active Directory's usual shape is a service account that searches for the
person, then a rebind as them to check the password:

<!-- docs-example: illustrative -->
```sh
TABULARIUS_LDAP_SEARCH_PASSWORD=... npm run tabularius -- serve ~/FileMakerFiles \
  --ldap-url ldaps://dc.example.com --ldap-base-dn "dc=example,dc=com" \
  --ldap-user-attribute sAMAccountName --ldap-search-dn "cn=svc,cn=users,dc=example,dc=com"
npm run tabularius -- privileges ~/FileMakerFiles Contacts external "Sales" "Data Entry"
```

A plain LDAP server that lets people bind straight as a predictable DN needs no
service account — give `--ldap-bind-dn-template "uid={user},ou=people,dc=example,dc=com"`
instead of the base DN. Groups are read from `memberOf` (`--ldap-group-attribute`
to change it) and matched by their common name, so an external account named
"Sales" matches `CN=Sales,…`. Use `ldaps://` wherever the directory is not on a
trusted network, since a plain bind sends the password.

For integrations, mint a scoped API token instead of embedding a password. A
token acts as one account (so it carries that account's privilege set), is used
as a Bearer token on the Data API and SQL endpoints, and can be revoked on its
own. `--read-only` makes it refuse every write and script. A token stops
working after 90 days unless `--expires-days N` says otherwise (`--expires-days 0`
makes one that never expires; `TABULARIUS_TOKEN_DEFAULT_DAYS` changes the default).

<!-- docs-example: illustrative -->
```sh
npm run tabularius -- token ~/FileMakerFiles Contacts create "Reporting" --read-only --expires-days 90
# ohbt_… (shown once; store it now)
curl -H "Authorization: Bearer ohbt_…" http://127.0.0.1:8080/fmi/data/vLatest/databases/Contacts/layouts
npm run tabularius -- token ~/FileMakerFiles Contacts list
npm run tabularius -- token ~/FileMakerFiles Contacts revoke <id>
```

For a second factor, turn on two-factor sign-in for an account. It then needs a
six-digit code from an authenticator app (Google Authenticator, 1Password, Authy
— anything that reads a standard `otpauth://` QR code) on top of its password,
in the web client and on the Data API `sessions` login (in a `X-Tabularius-OTP`
header). Scoped API tokens are the credential for unattended integrations, so
they aren't subject to it; identity-provider sign-in leaves the second factor to
the provider.

<!-- docs-example: illustrative -->
```sh
npm run tabularius -- totp ~/FileMakerFiles Contacts enroll Admin   # prints the secret and otpauth:// URI
npm run tabularius -- totp ~/FileMakerFiles Contacts confirm Admin 123456
npm run tabularius -- totp ~/FileMakerFiles Contacts status
npm run tabularius -- totp ~/FileMakerFiles Contacts disable Admin
```

`status` lists accounts with two-factor sign-in enabled, or says that none
have it enabled.

The admin console's Security health page starts with **Risky setups**, a
privilege audit in plain English, worst first. It flags full-access accounts with
no password or only a password, guest access, extended privileges (Data API,
OData, ODBC, ...) switched on for sets whose accounts haven't signed in lately,
record-level limits that are true for every record ("1 = 1"), and unstored
calculations a limited set can see that total records it can't view. Each one
comes with what to change in Manage Security. It changes nothing, and it never
shows passwords or record values. MCP clients and the assistant (in Manage
Security) get the same review as `review_privileges`, for [Full Access] only.

After five wrong passwords in 15 minutes from one address, that address can't
sign in to the account for 15 minutes (Data API, web client and AI alike);
other addresses still can, so a stranger guessing can't lock the real user out.

Container fields read as signed download URLs that expire (an hour by default;
`TABULARIUS_CONTAINER_TTL` seconds, or `0` to never expire), so a link that leaks
into a browser history or a proxy log stops working. A link made for a signed-in account is tied to that account's entry in the file (the mapping account, for a directory or identity-provider sign-in) and stops working while the account is blocked or removed, even if someone later makes a new account with the same name (other accounts' links are not affected; a sign-in with no entry of its own gets links that simply expire); anyone holding a live link can still fetch that one file until it expires, so keep the expiry short on files that matter. Uploads stream to a temp
file as they arrive rather than sitting whole in memory, so a large file (or
several at once) costs disk, not a half-gig of heap per request, and the size
cap is enforced byte-by-byte (`TABULARIUS_UPLOAD_TMP` picks the scratch folder).

Container URLs answer range requests, so videos and audio play and seek in
the browser and big downloads resume; files over a megabyte are stored in
1 MB pieces, so a range reads only the pieces it covers. A file that has not
changed is not sent again (`ETag` and `Last-Modified`, the latter not for a file stored before the time was kept, with `If-None-Match`,
`If-Modified-Since`, `If-Match`, `If-Unmodified-Since` and `If-Range`), and a
request for one range past the end of the file is answered 416. Several ranges
in one request are not served as multipart: the whole file is sent, as RFC 9110
lets a server do with a Range it will not serve. A file put in a container is read from the request and
written to the database in 1 MB pieces, so a file of hundreds of megabytes
costs disk, not memory. The web client sends a file of 8 MB or more in pieces
of its own (below): a dropped connection picks up where it stopped, with a
progress bar and Cancel. A container converted from a FileMaker file keeps
each file whole, as FileMaker stored it, so a range of it still reads that
whole file from the database; putting the file in again stores it in pieces. Add `&thumb=256`
to a container URL for a thumbnail that fits 256 by 256 pixels. PNG, GIF
and JPEG thumbnails are made by Tabularius itself, with JPEGs read at an
eighth of their size, which is fast even for big photos, and turned upright
by their EXIF orientation. PDFs and other formats need `pdftoppm` (Poppler;
in the Docker image) or, on a Mac, the built-in `sips`. Thumbnails are kept
in memory, and `TABULARIUS_THUMBNAILS=builtin` turns the outside tools off.

Every record created, changed or deleted is logged with the account and time,
with no setup: edits keep each field's old and new value, deletes keep what the
record held, a duplicate says which record it copied, and every entry says where
it came from (`web` client, `rest` Data API, `odata`, `mcp`, `admin`, an
`automation`, ...) and the script that made it. Container contents are never
logged, only the name, size and a SHA-256 hash. Reads are not logged unless an
administrator sets `logReads` (below). An administrator can name fields
whose values are never logged (the entry shows `‹not logged›`), or turn that on
for every field named like a password, secret, token, API key or card number,
with `PUT /tabularius/admin/v1/audit/settings?database=`
(`{"excludeFields": {"Table": ["Field"]}, "redactSensitive": true, "logReads": true}`; `GET` also
lists the fields it would suggest). Values that are not logged cannot be put
back by Undo or a revert, so this is off until chosen. The log is append-only
and tamper-evident: each entry is linked to the one before it by a SHA-256 hash,
and `GET /tabularius/admin/v1/audit/verify?database=` finds an entry that was
edited, removed, added behind its back or cut off the end. `retentionDays` in
the same settings removes entries older than that, hourly, and the chain
records where it now starts and the removal is logged as a security event.
Read it with `npm run tabularius -- audit ~/FileMakerFiles Contacts --table
Invoices --record 42`, the `audit_log` AI tool, or `GET
/tabularius/design/v1/databases/{db}/audit`; the last two need [Full Access].

For desktop AI apps, the MCP connection runs over stdio with
`npm run tabularius -- mcp ~/FileMakerFiles`. Add `--account "AI Helper"` to use
that account (its password comes from `TABULARIUS_PASSWORD`); without an account
it acts as the server administrator. `--ai-exclude A,B` keeps the named files
from the AI connection.

Use it from Claude Desktop (or any MCP client) by adding to its MCP config:

```json
{ "mcpServers": { "tabularius": {
    "command": "node",
    "args": ["/path/to/tabularius/packages/cli/src/main.ts", "mcp", "/path/to/FileMakerFiles"]
} } }
```

Add `"--account", "AI Helper"` to the args (and `"env": {"TABULARIUS_PASSWORD":
"..."}`) to have the AI work within that account's privilege set; without one
it acts as the server administrator.

Or connect over HTTP at `http://127.0.0.1:8080/mcp`: with HTTP Basic auth
(an account and password) the AI gets that account's privileges; local
clients without auth, or with the `--mcp-token` bearer token, are the
administrator. "Local" means a direct request from this computer: not one a
proxy on it passed on, and not one addressed to any name but `localhost`,
`127.0.0.1` or `[::1]` (so a web page can't reach it by pointing its own name
at this computer); give anything else a token or an account.
Every tool, with its parameters, permissions and an example, is in
[docs/reference/mcp.md](docs/reference/mcp.md); every REST route in
[docs/reference/rest.md](docs/reference/rest.md).

The easiest way to connect an AI app is the admin console's **Connect an AI app**
section (guide at `/docs/connect-ai`, from [docs/connect-ai.md](docs/connect-ai.md)):
pick a file, then a new AI agent account (never `[Full Access]`, its changes
optionally held for a person to approve) or an existing account, and any limits
(read-only, only some layouts, a lifetime; 90 days unless you pick another). It makes one of the file's API tokens
for AI apps only (shown once; only its hash is kept) with the settings to paste
into Claude Code, Claude Desktop or any other MCP client, and checks it works.
A limited token sees no design and gets no SQL or free-form calculations. MCP
clients also get resources (`tabularius://FILE/schema`, `overview`,
`conversion-guide`) and prompts such as `after_converting`, `clean_up_data`,
`what_would_break`, `suggest_rules` and `make_dashboard`. Older admin console
tokens (`ohm_`) keep working until revoked.

### Connect Claude Code

Control a hosted solution from a Claude Code session. In the admin console's
**Connect an AI app**, pick the file and make a token (read-only, limited to
some layouts, or for a shorter or longer time than the 90 days it gets), then run:

```
claude mcp add --transport http tabularius http://SERVER:8080/mcp --header "Authorization: Bearer ohbt_…"
```

Claude Code then finds, reads and edits records, lists layouts and schema and
runs scripts as that account, within its privileges. The Tabularius plugin
(`/plugin marketplace add sitotisai/tabularius`, then
`/plugin install tabularius@tabularius`) makes the connection and adds a skill
that teaches Claude Code the safe way to use the tools. Details, Claude Desktop and
claude.ai connector steps: [docs/connect-ai.md](docs/connect-ai.md).

As a library:

```ts
import { FmpDatabase } from '@tabularius/fmp12';

const db = FmpDatabase.open('Contacts.fmp12');
console.log(db.schema.tables.map((t) => t.name));
for (const row of db.records('Contacts')) console.log(row.recordId, row.fields);
```

## Hosting for a team

[ADMIN.md](ADMIN.md) is the guide for whoever runs the server: install, upgrade, backups, certificates, moving from FileMaker Server (`tabularius migrate-fms`) and the Admin APIs.

Install it with one command. From a checkout (it uses your Node 22.20+ or
downloads its own, and puts `tabularius` in `~/.local/bin`):

```sh
./scripts/install.sh --service ~/Databases   # starts at login/boot (launchd or systemd)
```

For a server machine nobody logs in to, add `--system`: it runs at boot as
you (a LaunchDaemon on macOS, a system unit on Linux, which may also use
port 443), asking for `sudo` once. Options after `--` go to `tabularius serve`,
and `--print` shows the service file without installing anything:

```sh
./scripts/install.sh --service /srv/Databases --system --port 443 -- --https files.example.com --sql-port 5432
./scripts/install.sh --uninstall             # stops and removes the service; files stay
```

On **Windows**, from PowerShell (it uses or downloads Node the same way and
puts `tabularius` on your PATH):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Service C:\Databases
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Service C:\Databases -System   # at boot; administrator prompt
```

It is a Task Scheduler task that starts at sign-in, or with `-System` at boot
as the system account (and opens the port in Windows Firewall), started
again a minute after it stops unexpectedly. Node can't answer Windows'
service manager by itself, so this is the built-in way to keep it running
without installing a wrapper program.

Once installed, the same is one command on every system:
`tabularius service install <folder> [--system] [--port 8080] [--host 127.0.0.1] [-- serve options]`
(it listens on this computer only until you give `--host 0.0.0.0` and HTTPS, for example `-- --https local`),
`tabularius service print ...` and `tabularius service uninstall`.

**Upgrading in place.** `tabularius upgrade` (or `install.sh --upgrade`,
`install.ps1 -Upgrade`) fetches the newest version into the install, backs up
the hosted folder, restarts the service and waits for it to answer its health
check. If the new version doesn't start, it puts the previous one back and
starts that again. Hosted files and backups are never touched: each file is
brought up to date by the new version as it opens it. It refuses an install
with local changes, so nothing of yours is overwritten.

Or with Docker, hosting `./Databases`:

```sh
mkdir Databases && sudo chown 1000:1000 Databases   # the container runs as an unprivileged user (uid 1000)
docker compose up -d
```

For a read-only root filesystem and no extra capabilities, add
`-f compose.yaml -f compose.hardened.yaml`; for HTTPS from Caddy (with your
name in `Caddyfile`), use `docker compose -f compose.https.yaml up -d`.

Drop `.fmp12` files into the folder, even while the server runs: each is
converted once (in the background, so nobody waits) and hosted. The port is published on this computer only (`127.0.0.1:8080`). To let others on your network open `http://<this machine>:8080/`, change `compose.yaml` to publish `"8080:8080"`; that is plain HTTP, so passwords cross the network unencrypted. Prefer `compose.https.yaml`.

A browser is never "the server's own computer" to a server in a container, so an account with an empty password can't sign in there, and the admin console has no password yet. The image has the `tabularius` command, working on the mounted folder `/data`:

<!-- docs-example: illustrative -->
```sh
docker compose exec tabularius tabularius admin-password /data
docker compose exec tabularius tabularius passwd /data Contacts Admin    # file, then account
```

**Over the internet**, point a name at the machine and let the server get
its own certificate from Let's Encrypt, renewed a month before it runs out:

<!-- docs-example: illustrative -->
```sh
tabularius serve ~/Databases --https files.example.com --https-email you@example.com
```

That serves `https://files.example.com/` on port 443. Port 80 must reach the
machine too: Let's Encrypt checks the name there, and it sends everyone else
on to https. On Linux, let Node use those ports with
`sudo setcap cap_net_bind_service=+ep $(which node)`. Keys and certificates
are kept in `<folder>/.openhbam-tls`. Your own certificate works too
(`--tls-cert`/`--tls-key`), as does a proxy such as Caddy (with `--public-url`,
and `--proxy-header x-forwarded-for`, plus `--trusted-proxies IP/CIDR,...`
when the proxy connects from another machine or container, so lockouts and
logs see each visitor; ADMIN.md has the details and Compose setup).

**Editing together.** Typing in a record locks it until you leave it; others
see "In use by Ann" and can't change it in the meantime. Locks lapse a minute
after the editor's window stops renewing them (a closed tab), and logging out
releases them. Every window hears about changes as they happen and redraws
the records it shows, without disturbing a field someone is typing in.
Clients other than the web client can use the same endpoints
(`/tabularius/live/v1/databases/{db}/events`, `.../locks`, `.../clients`, and
`.../layouts/{layout}/records/{id}/lock`, see
[packages/server/src/live.ts](packages/server/src/live.ts)).
A session may hold 10 event streams open at once (opening an 11th closes the oldest), and a stream whose reader has stopped taking data, with 256 KB waiting to be sent, is closed; the web client reconnects on its own.

**Admin console.** Open `/admin/` to see who is connected (and disconnect
them), who is editing or looking at which record, the hosted files, and backups, with a
"Back up now" button. It only opens on the server's own machine until you
set a password with `tabularius admin-password <folder>`; its sign-in page asks
for that password (no user name). For HTTPS on a local network without buying
a name, serve with `--https local`. Once a password is
set, five wrong guesses from one address lock it out for fifteen minutes
(the server answers 429 with a `Retry-After`), so the single password can't
be brute-forced.

**Hosting a file from the browser.** Under "Host a FileMaker file" in the
admin console, pick a `.fmp12` and press "Upload and host". It goes up in
16 MB pieces (a dropped connection retries the piece, so multi-gigabyte
files are fine), then converts on a worker thread while the console shows
tables and records as they're copied. When it's done the file is hosted
live, with no restart, and the console shows the conversion report: what in
the file won't work yet. The same steps are an API for scripts:
`POST /tabularius/admin/v1/uploads` with `{name, size}`, then
`PUT .../uploads/{id}?offset=N` for each piece, then
`POST .../uploads/{id}/finish`; `GET .../uploads` shows progress.

**FileMaker's Admin API.** Tools written for FileMaker Server's Admin API
(v2) can use `/fmi/admin/api/v2`: the real `fmcsadmin` was run against it for
most of its commands ([docs/fmcsadmin-parity.md](docs/fmcsadmin-parity.md) says
which); Claris Connect's FileMaker Admin connector has not been tried. Sign in at `POST /user/auth` with the admin
password (any user name) as HTTP Basic, then send the token as `Bearer`. The
Admin API needs that Basic login and an admin password set: the console
cookie, the local admin channel and a loopback connection don't sign in to it. You can list
files and open, close, pause or resume them; closing a file ends its
sessions. You can also list clients, disconnect them or send them a message,
and stop or start the server, which closes and reopens every file. Script
schedules can be listed, created, changed, run (`{"status":"RUNNING"}`),
duplicated and deleted. Only FileMaker script schedules exist here; ones
made through the API never reach the network. Backups keep their own
settings, so backup, verify and system-script schedules answer code 21 (not
supported). `serverVersion` reports the Admin API level this matches, and
`product` says it's Tabularius. Blocking new users (`/server/config/blocknewusers`,
fmcsadmin's `set serverprefs BlockNewUsersEnabled=true`, or the button under
**Connected** in the admin console) stops new sign-ins everywhere (web client,
Data API, AI apps, SQL) while sessions already open carry on; every worker
follows it and it lasts across restarts. Calls that carry their credentials
each time (API tokens, OData, MCP with an account and password) start no
session and keep working. `fmcsadmin list plugins` lists the
installed plug-ins, and `get serverconfig`, `get serverprefs` and `get cwpconfig` answer with
values that describe Tabularius (no limits on files or connections); changing
those answers code 21. `fmcsadmin certificate create`, `certificate import`
and `certificate delete` put a certificate authority's certificate in place:
the request's key and the certificate are kept in the folder
(`.openhbam-tls/imported`), the folder's settings name them for the next
start, and a server serving https by itself uses a new certificate at once.

**Change feed and webhooks.** Other systems can keep up with a hosted file
without polling every table. `GET /tabularius/changes/v1/databases/{db}` (signed
in like the Data API) answers with a cursor. Call it again with `?since=` set
to that cursor to get every create, update and delete since then. Each change
has its kind, table, record id and modification count, but no field data:
read the record through the Data API, where privileges apply. Only records
the account may view are listed. `&wait=30` holds the request open until
something changes. Changes are kept in memory (the last 10,000 per file). A
cursor older than that, or from before a restart, answers 410 with a fresh
one. Webhooks push the same changes: add one in the admin console API
(`POST /tabularius/admin/v1/webhooks` with `{url, database, tables}`). Each
delivery is a batch signed with `x-tabularius-signature: sha256=<HMAC of the
body>` using the secret returned when the webhook was made. Like scripts,
the server sends nothing out unless started with `--allow-webhooks`.

**Inbound hooks.** Another service can run a script by calling the server:
add a hook in the admin console (Inbound hooks) with the file, the script and
the account it runs as. The secret is shown once. Each call is a `POST` to
`/tabularius/hooks/v1/<id>` with a JSON body (256 KB at most), which becomes
`Get ( ScriptParameter )`. It carries `X-Tabularius-Timestamp` (Unix seconds) and
`X-Tabularius-Signature: sha256=<hex HMAC-SHA256 of "timestamp.body">`. A call
more than five minutes off the server's clock, one already received, or one
over the hook's calls-a-minute limit is refused. The answer is
`{"ok": true, "result": "<the script's result>"}`, or the error. The script runs
within the account's privileges, offline unless the server and the hook both
allow the network, and with no AI steps. The admin console lists each hook's
recent calls (never their bodies). The server answers no calls unless started
with `--allow-inbound-hooks`, and a capture-only file never has a hook.

**Health and metrics.** `GET /tabularius/health` answers `{"status":"ok"}`
without signing in, for load balancers, Docker and Kubernetes (the Docker
image uses it as its health check). `GET /tabularius/admin/v1/metrics` gives
Prometheus metrics, signed in with the admin password: requests by kind
and status with their durations, sessions, live-update streams and record
locks per file, file sizes, PostgreSQL connections, the last backup,
progressive and off-site runs, script schedules, the certificate's expiry,
standbys, memory, active timers and sockets, CPU and event loop delay. In Prometheus:

```yaml
scrape_configs:
  - job_name: tabularius
    metrics_path: /tabularius/admin/v1/metrics
    basic_auth: { username: admin, password: <admin password> }
    static_configs: [{ targets: ['filemaker.example.com:8080'] }]
```

**Script schedules.** Like FileMaker Server's, the admin console runs a
script of a hosted file every so many minutes, optionally lined up with a time
of day (every 1440 minutes from 02:00 is nightly at 2 a.m.). A schedule runs as
an account of the file, within its privileges, and shows its next and last run,
its last error, and (under "Runs") its last 50 runs with how each went, kept
across restarts in `<folder>/.openhbam-schedule-runs.json`.
Scheduled scripts are offline: they never reach the network or send mail, even
on a server started with `--allow-script-network`, unless the schedule allows
it too. Scripts an AI runs (the `run_script` MCP tool) are always offline. Schedules are kept in `<folder>/.openhbam-schedules.json`. Import
Records in any script reads only from `<folder>/Documents`.

**Plug-in functions.** Calculations run the safe, local BaseElements
functions natively and never load a plug-in:
- **JSON, regex and stacks:** `BE_JSONPath`, `BE_RegularExpression` (options i, m, s, x, g, v) and the `BE_Stack…` functions.
- **Text files:** `BE_FileReadText`, `BE_FileWriteText`, `BE_FileExists` and `BE_FileSize` only touch `<folder>/Documents` and a run's temporary folder, as the file script steps do. Any other path counts only by its file name. `BE_GetLastError` reports a missing file as 2.
- **Refused:** network and mail calls (`BE_HTTP_…`, `BE_SMTP_…`, `BE_FTP_…`), shell commands, the clipboard, folder pickers and file moves or deletes give "?" and error 3, whatever the network setting.
- **MBS:** text, path and container helpers and the Hash functions (digests, HMACs, CRCs; not PBKDF2 or files) are covered; every other MBS call answers with an MBS error.

**Perform Script on Server** works as on FileMaker Server:
- **A fresh session.** The script runs in a new session as the caller's account and privileges. It doesn't see the caller's layout, found set, record, global fields or variables, so pass what it needs in the parameter.
- **Locks.** Records the caller is editing are locked to it, as to anyone else (error 301).
- **Waiting.** With "Wait for completion", `Get ( ScriptResult )` and `Get ( LastError )` come back to the caller. Without it, the caller carries on while the script runs on its own.
- **Size limit.** Parameters and results are cut at a million characters.
- **Taking turns.** Server-side scripts, Perform Script on Server and schedules alike, take turns in one queue: at most the greater of 50 and the number of CPU cores run at once, first come first served. The admin status and `/metrics` show how many are running and waiting.
- **Nested calls.** Perform Script on Server inside a server-side script runs at once, so scripts waiting on each other can't fill the queue.
- **Same rules.** The script follows the same network rules as the caller.

**Connections.** The admin console's Connections page keeps the outside services
your solutions use, by name: S3-compatible storage (Amazon S3, Cloudflare R2,
Backblaze B2, MinIO, Wasabi), web APIs (REST, signed in with a bearer token,
basic sign-in, an API-key header or OAuth 2 client credentials) and an outgoing
mail account (SMTP). Add one with its settings (for storage: bucket, region,
endpoint and a folder to stay inside), type the secrets into their own boxes,
press Test (storage lists one object, mail signs in and sends nothing) and turn
it on. A mail connection marked "Send Mail steps use it" is what Send Mail via
SMTP uses when the server is started without `--send-mail`; the flag, when
given, wins. Mail through a connection is limited to 100 messages an hour for the
server and 50 an hour for each file whose scripts take part in a message, so a
runaway script cannot flood a mail server and one file cannot use up everyone's
allowance. The count is kept in `.openhbam-mail-sent.json` in the hosted folder
(times only, no addresses or text), so a restart does not start a loop afresh. One
message may name at most 20 recipients (To, CC and BCC together) unless the
connection's "Most recipients in one message" says up to 100; a message over the
cap is refused before anything is sent and does not count against the hour, and an
AI draft always starts at 20.
The keys are sealed on the server with AES-256-GCM and used only inside it, to
sign the one request being made: no script, plug-in, AI tool or API call is ever
given one, they are never logged, and the console only says whether each is set.
Start the server with `TABULARIUS_SECRETS_KEY` (a passphrase) and the key never
touches the folder; without it the server writes a key file only its user can
read beside the secrets. A connection can be limited to some hosted files.
[Connect an S3 bucket](docs/tutorials/connect-an-s3-bucket.md) walks through one
from start to a passing Test (a test runs it, so it stays true).
Scripts use one with Insert from URL and an address like
`connection://invoices/2026/scan.pdf`: with a container in `$file`, cURL options
`-X PUT --data-binary @$file` store it; the same address with no options fetches
it into a container field (or a variable); `-X DELETE` removes it; and
`connection://invoices/?prefix=2026/` lists a folder (S3's XML, with names
relative to the connection's folder). A script can't reach beyond the
connection's bucket and folder, add ACLs or copy sources, or see the keys. Like
every outbound step it works only on a server started with
`--allow-script-network` (never for an AI-run script, a schedule that doesn't
allow the network, an automation or an inbound hook, or any script run offline), never when a capture-only file
(named in `--capture-only`) is anywhere on the call stack, and in outbound test mode
it is recorded and reaches only allowlisted hosts. Ask an AI app, or the assistant in the web client ("set up an S3
connection to our invoices bucket"), and it calls `draft_connection`: that makes
a draft with the settings you gave, limited to the file you asked from, and
nothing more. The AI never sees, asks for or invents a key (a setting that
looks like one is refused, and no tool sets keys, approves, changes or uses a
connection); you open Connections, check the settings, type the keys, press Test
and approve. `list_connections` shows what exists and which secrets are set,
never their values. Both need [Full Access] and are never offered a capture-only
file. The same is `/tabularius/admin/v1/connections`. In the web client's assistant
the draft also comes with a card under the answer: on a server started with
`--allow-app-connections`, a [Full Access] person types the keys into its
password boxes, presses Test and approves right there (the same checks, only for
a draft the AI made for the file they are in, and the card says which host the keys
will go to); on any other server the card shows the draft and says to finish it in
the console.

Cloud storage that signs in with OAuth 2 (Google Drive, Dropbox, Microsoft
OneDrive) is a web-service connection with sign-in `oauth2-refresh`: you get a
refresh token from the service once (its own authorize page or console), type the
client ID, client secret and refresh token into the secret boxes, and the server
swaps it for short-lived access tokens itself, kept in memory and never written
down. Choosing the service under "Start from" when you add the connection (or
asking an AI app, which lists them in `list_connections`) fills in the addresses and
scope and says where the three secrets come from. Dropbox answers everything with
POST and Google Drive uploads need it too, so those connections are switched to
Allowed: write by a person; an AI draft starts at read. A service that issues a new
refresh token on every use is not supported.

A scheduled script (network switch on) uses connections, and mail through an
email connection, only while everything in the hosted files that can run or steer
code is as a person last approved it for that schedule: scripts, custom
functions, field formulas, layouts (triggers and buttons), custom menus, file
options, data sources and table occurrences, in every hosted file, because a
script can call another file's. A schedule records that when someone turns its
network switch on in the console. If anything changes after that (an AI can edit
all of it), the schedule's runs go ahead without connections, the run says what
changed, the log gets a warning once, and the Schedules page lists the changes
beside an "Approve scripts" button. The check is made again at every connection
request, so an edit while a run waits its turn or is under way is caught too. A
schedule made before this was added needs one approval. The network switch
itself, and mail on the operator's own `--send-mail` flag, are not connections
and are not held; a script a person runs from the web app, the Data API or OData
uses connections like any other network script.

**Backups.** The server backs up every hosted file once a day into
`<folder>/Backups/<date_time>/`, keeping the last 7, while people keep
working (`--backup-every 6h`, `--keep 30`, `--backup-dir`, `--no-backups`). The folder can also be set in the admin console's Backups section: it is checked by writing to it, saved in the folder's settings so a restart keeps it, and used at once unless point-in-time backups or an off-site copy follow the old folder (then after a restart). A `--backup-dir` given at start counts over it. Sets already taken stay where they are.
Each copy is checked before its set is kept.

[Back up a file and restore it](docs/tutorials/backup-and-restore.md) walks through making a file,
checking its backup and recovering its records after deleting the hosted store.

By hand:

<!-- docs-example: illustrative -->
```sh
tabularius backup ~/Databases                          # now
tabularius restore ~/Databases 2026-10-11_020000       # stop the server first
tabularius restore ~/Databases 2026-10-11_020000 Contacts   # just one file
```

**Backup verification.** After each backup the server reads the new set back
as a restore would: each copy must match the checksum taken with it, decrypt
when backups are encrypted, and pass SQLite's full integrity check. It then
checks one older set again, the one checked longest ago, so a copy damaged
later on the disk is found while there are good ones to fall back on. The
admin console shows each set as good or damaged (and what is wrong), has a
**Check now** button per set, and the Event log records each check. A
scheduled backup whose set fails counts as failed in `/metrics`. By hand:
`tabularius verify-backup ~/Databases [set]`, which exits 1 when a set is
damaged, or `POST /tabularius/admin/v1/backups/{set}/verify`.

**Point-in-time backups** (FileMaker Server's progressive backups): with
`serve --progressive 5m`, the server also saves each file's changes every 5
minutes into the newest backup set, after a full backup when it starts. Put
a file back as it was at any of those moments, design changes included:

<!-- docs-example: illustrative -->
```sh
tabularius restore ~/Databases --at "2026-10-11 14:05" Contacts
```

You don't need to stop the server. In the admin console, under Backups,
**Restore a file to a moment** puts a file back while everything else keeps
running. It can host the restored file as a new file next to the current
one, so you can copy what was lost, or restore it in place, which
disconnects that file's users and opens it again. The same is
`POST /tabularius/admin/v1/restore` with `{database, at, mode: "copy" |
"replace", name}`. After an in-place restore the server makes a fresh
backup, so later changes can be restored on top of it.

**Slowest scripts.** The admin console times every script the server runs,
from the Data API, web client, schedules, OData and AI tools. It lists them
slowest first, with runs, average, longest and total time. Open one to see
which steps its time goes to: each step's own time, not counting the
scripts it calls. Counting starts when the server starts, and **Start
counting again** clears it. The same is `GET /tabularius/admin/v1/profile`, and
`DELETE` to reset.

**Slow finds.** Finds are timed too, grouped by table, the fields searched and
the sort, whatever the values. Below the slowest scripts, the console lists
the finds that took 50 ms or more on average. Each one names an index to add
where a stored field has none, with an **Add index** button. Where no index can
help, it says why in plain words: an unstored calculation, or a criterion that
starts with `*`. An index is Tabularius's own SQLite index, and the file's design
doesn't change. The same is `GET /tabularius/admin/v1/profile/finds` and
`POST /tabularius/admin/v1/indexes`. MCP clients and the assistant ([Full
Access]) get `suggest_indexes`.

**Logs.** Like FileMaker Server's Logs folder, the server keeps tab-separated
logs in `<folder>/Logs`, each moved to `<name>-old.log` at 40 MB and started
again:

| Log | What it records | FileMaker Server's |
| --- | --- | --- |
| `Event.log` | start and stop, files opened and closed, backups, schedules, errors | Event.log |
| `Access.log` | sign-ins, sign-outs, timeouts and failed sign-ins, with the address | Access.log |
| `ScriptEvent.log` | schedules, Perform Script on Server and Data API scripts that ended with an error | FMSEScriptErrors.log |
| `fmdapi.log` | every Data API call: method, path, status, error code, time, bytes, account | fmdapi.log |
| `Admin.log` | changes made in the admin console and the Admin API | fac.log |

Passwords never reach a log, and session tokens are cut out of paths. The
admin console's **Logs** section shows one log at a time, newest first, with
filters by type, time and text, and a **Download** link. The same is
`GET /tabularius/admin/v1/logs`, `/logs/{name}?type=&from=&to=&q=&limit=` and
`/logs/{name}/download` (`?old=1` for the older half). With `--workers`,
every process writes to the same files and only the first starts them again.

**Statistics logs.** Two more files in the same folder use FileMaker Server's
own layout (a header line, then tab-separated rows, times in microseconds), so
monitoring set up for a FileMaker Server's Logs folder (Zabbix and Splunk
templates, log viewers) should read them as they are (none of those templates is
in the test suite): `Stats.log` has a line a
minute with the network rates, clients, open files, sessions, calls per second,
calls under way and the time a call takes; `TopCallStats.log` has the slowest
25 calls of each minute, summed by what was asked and who asked, with bytes each
way. Disk read and write rates are the server process's own, read from
`/proc/self/io`, so they are real on Linux and show 0 elsewhere (with
`--workers`, only the process that writes the line). Cache percentages and the
wait and I/O parts of a call's time are not measured and show 0. Live-update streams are left out, and session
tokens are cut from targets. `serve --stats-interval 30s` changes the minute
(`off` stops them; `TABULARIUS_STATS_INTERVAL` does the same). With `--workers`,
`Stats.log` adds every process up and each writes its own top calls.

**Encryption at rest.** Set `TABULARIUS_BACKUP_KEY` to a passphrase and every
backup file, point-in-time changes included, is encrypted as it is written
(AES-256-GCM, key from the passphrase with scrypt), so a copied or off-site
backup is unreadable without it. Restore needs the same passphrase, and
refuses a wrong one or a damaged file before putting anything back. Keep the
passphrase somewhere other than the backups: without it they can't be
restored.

**What a backup protects against.** An unencrypted set carries SHA-256
checksums, which catch a damaged disk, a cut-short copy or a sync that went
wrong. They do not stop someone who can write the backup folder: that person can
change a copy and write the matching checksum, so an unencrypted set is protected
against accidents only. With `TABULARIUS_BACKUP_KEY` set, a set is also protected
against someone who can write the folder but does not know the passphrase: each
copy is authenticated, and the list of checksums, the finish times, each
container file's checksum, size and modification time, and, for restoring to a
moment, how many logs were saved and a chain over them are signed with the passphrase. A restore, whole-set or to
a moment, refuses a set whose signature does not match, a copy that is swapped,
renamed, or taken from an older set, and, while the passphrase is set, a set with no
signature at all (including a set someone put in the folder), unless you say
`--accept-unsigned-backup`. A set made before signatures existed, or before the
passphrase was set, or signed by an earlier build (whose signature covered less), is such a set: `verify-backup <folder> <set> --sign` reads every
copy back and signs it, but it cannot tell whether the copies were swapped before it
ran, so use it only on a set that has not been out of your hands. A whole older set,
signature and all, is still a valid set, so a restore says which files had changes
after the backup was taken (those changes are not in the restored file) and leaves the
choice to you.

A restore to a moment of a signed set replays only the logs the signature counts, and
refuses the set if one of them was removed, replaced, changed or cut off at a record
boundary, if a log in the old format or one that is not encrypted is among them, or
if the logs were not saved by this backup. A log the signature does not count yet (the
server writes a log before it signs it, so a crash between the two leaves one) is
ignored. Also not covered: a log made before this version carries no binding to its
time or file, file names that the operating system treats as another (reserved names
on Windows), and anyone who has the passphrase and write access to the folder, who can
make a set that restores.

The hosted stores themselves can be encrypted at rest too. Set
`TABULARIUS_ENCRYPTION_KEY` to a passphrase and each store is kept as
`<name>.openhbam.sqlite.enc` on disk (AES-256-GCM, scrypt), decrypted into its
working file only while the server runs and re-encrypted on a clean shutdown,
so a stolen disk or a copied folder holds no readable data. `serve` unlocks
them with the key at start; encrypt or decrypt a stopped folder yourself with
`tabularius encrypt <folder>` / `tabularius decrypt <folder>` (same key in the
environment). The key is never written to the folder.

<!-- docs-example: illustrative -->
```sh
export TABULARIUS_ENCRYPTION_KEY='a long passphrase'
tabularius encrypt ~/FileMakerFiles      # turn the hosted stores into .enc (server stopped)
tabularius serve ~/FileMakerFiles        # unlocks them, re-encrypts on Ctrl-C
```

This guards data at rest. While the server runs, the working file is plaintext
(node:sqlite has no page-level encryption, FileMaker's EAR aside), and a hard
crash can leave that working file behind until the next clean shutdown, so also
keep the hosted folder on an encrypted disk (FileVault on macOS, BitLocker on
Windows, LUKS on Linux) for defence in depth.

**Off-site backups.** Copy the backups folder to any S3-compatible storage
(Amazon S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi) after each backup
and every few minutes for point-in-time changes. Sets pruned locally are
removed there too, and with `TABULARIUS_BACKUP_KEY` set only encrypted files
leave the machine:

<!-- docs-example: illustrative -->
```sh
export TABULARIUS_S3_ACCESS_KEY=... TABULARIUS_S3_SECRET_KEY=...
tabularius serve ~/Databases --backup-s3 s3://my-bucket/office --s3-endpoint https://<account>.r2.cloudflarestorage.com
tabularius restore ~/Databases --at "2026-10-11 14:05" --from s3://my-bucket/office   # on any machine
```

**A standby server**: a second machine keeps copies of every hosted file, a
second or so behind, ready to take over if the main one fails:

<!-- docs-example: illustrative -->
```sh
tabularius serve ~/Databases --host 0.0.0.0 --https local --replication-token "$TOKEN"     # main
tabularius standby ~/Standby --primary https://main:8080 --token "$TOKEN"     # standby
```

The standby copies each file once, then applies its changes as they happen
(it carries on after either side restarts). To take over, stop the standby
and run `tabularius serve ~/Standby`. The admin console shows which standbys
are following and how far behind they are. [What a standby promises, what a takeover
gives you and what it does not copy](docs/standby-guarantees.md). Over the internet, give the main
server a certificate (`--tls-cert`/`--tls-key`); for a self-signed one, start
the standby with `NODE_EXTRA_CA_CERTS=cert.pem`.

**SQL for reports and BI tools** (FileMaker's ODBC/JDBC). Grant the
`fmxdbc` extended privilege (`tabularius privileges <folder> <db> grant
<set> fmxdbc`), then query with FileMaker SQL, as in ExecuteSQL, by table
occurrence name:

```sh
curl -u Ann:secret "http://server:8080/tabularius/sql/v1/databases/Contacts?format=csv&q=SELECT+*+FROM+People"
```

`POST` the same URL with `{"sql": "...", "params": [...]}` for JSON, and
`GET .../tables` lists the tables and columns. Spreadsheets can load the
CSV URL directly (Excel's Data > From Web, with Basic sign-in). Only SELECT
runs, and only for accounts that can view every record and field.

**PostgreSQL connections** for tools that speak to databases rather than
URLs (Power BI, Tableau, Metabase, Excel through the PostgreSQL ODBC driver,
JDBC, psql; the tests drive the protocol directly and with asyncpg, and those
tools are not in the suite): start the server with `--sql-port 5432`, then connect with the
file's name as the database and an account with `fmxdbc`:

```sh
psql "host=server port=5432 dbname=Contacts user=Ann sslmode=require"
```

Queries are the same read-only FileMaker SQL. Tools that browse a database
see each table occurrence as a table in the `public` schema, with its fields
as columns: psql's `\dt` and `\d`, `information_schema`, and the
`pg_catalog` queries JDBC and ODBC drivers send for their table and column
lists. Drivers that read values in PostgreSQL's binary format (asyncpg,
Npgsql, psycopg's binary cursors) work too; a parameter's type comes from
the driver or a cast such as `$1::numeric`, and is text otherwise.
Calculated columns with no field behind them come back as text.
Each query may return at most **100,000 rows** by default, including prepared queries
and suspended portals (`TABULARIUS_PGWIRE_MAX_ROWS` sets a different
whole-number cap, 0 for no cap; invalid or negative values use the default).
Larger results fail before any rows are sent, with
SQLSTATE `54000`: `SQL results are limited to 100000 rows; use LIMIT and page through the result with a stable ORDER BY`
(the message uses the configured cap).
An Execute message's row count only controls delivery; use SQL `LIMIT` to
bound each query. See the [memory measurements](docs/pgwire-results.md).
There are no indexes or keys to show. The password is sent as typed,
so connections from other machines must use TLS (the server's certificate,
from `--https` or `--tls-cert`); `sslmode=require` asks for it.

**OData for Excel and Power BI**, as on FileMaker Server. Grant the
`fmodata` extended privilege, then point an OData feed at
`https://server/fmi/odata/v4/<file>` (Excel: Data > Get Data > From OData
Feed; Power BI: Get Data > OData feed) and sign in with Basic. Each table
occurrence is an entity set, keyed by `ROWID`:

```sh
curl -u Ann:secret "https://server/fmi/odata/v4/Contacts/People?\$filter=City%20eq%20'Oslo'&\$select=Name,City&\$orderby=Name&\$top=50"
```

`$filter` (comparisons, `and`/`or`/`not`, `contains`, `startswith`, date
parts and more), `$search` (words and "phrases" in any text field, with
`AND`, `OR` and `NOT`), `$select`, `$orderby`, `$top`, `$skip` and `$count` work,
and long lists come 1,000 records a page with `@odata.nextLink`. `POST` to
the entity set creates a record; `PATCH` and `DELETE` on `People(12)`
change and delete one, with `If-Match` on the ETag so nobody's save is
lost. `PATCH People(12)/Photo` with a file as the body puts it in a container
field (or send it as base64 in the record's JSON), and `DELETE` empties it. `POST .../Contacts/Script.Name` with `{"scriptParameterValue": "..."}`
runs a script. Each relationship gives the occurrences at both ends a
navigation property to the other, so `People?$expand=Orders` puts each
person's related orders inline (with `Orders($filter=Total gt 50;$orderby=Total desc;$top=5)`
for fewer) and `People(12)/Orders` lists them (`People(12)/Orders/$count` counts
them, `People(12)/Orders(40)` reads one); up to 1,000 related records come
for each record, and a page with very many ends early with its next link. A
relationship is offered only when the account can read its match fields. Unlike SQL, OData follows record and field access, so any
privilege set can use it, related records included. `POST .../Contacts/$batch`
sends several requests in one (multipart/mixed or JSON); a change set in it
is kept all or nothing. `$apply` gives groups and totals without reading
every record: `People?$apply=filter(Age ge 18)/groupby((City),aggregate(Age with average as MeanAge,$count as N))`.
`$crossjoin(Customers,Orders)?$filter=Customers/ID eq Orders/CustomerID` pairs
records across sets, each read as the account sees it.
[Full Access] can change the schema the way FileMaker Server's OData does:
`POST .../Contacts/FileMaker_Tables` with `{"tableName": "Visits",
"fields": [{"name": "Code", "type": "VARCHAR(10)", "primary": true}]}`
makes a table, `PATCH .../FileMaker_Tables/Visits` adds fields, `DELETE`
removes a table or field, and `FileMaker_Indexes` adds and removes indexes.

**Legacy XML (Custom Web Publishing), reads only.** Scripts and pages written
against FileMaker Server's `/fmi/xml` can keep reading. Grant the `fmxml`
extended privilege, then ask with HTTP Basic:

```sh
curl -u Ann:secret "https://server/fmi/xml/fmresultset.xml?-db=Contacts&-lay=People&City=Oslo&City.op=eq&-sortfield.1=Name&-max=20&-find"
```

The document name is the grammar: `fmresultset.xml`, `FMPXMLRESULT.xml`, or
`FMPXMLLAYOUT.xml` for `-view`. `-dbnames`, `-layoutnames`, `-scriptnames`,
`-find`, `-findall`, `-findany`, `-findquery` and `-view` work, with `-skip`,
`-max`, `-sortfield.N`/`-sortorder.N`, `-lop`, `-recid`, `-lay.response`, and
`field=value` with `field.op` (`eq`, `cn`, `bw` (the default), `ew`, `gt`, `gte`,
`lt`, `lte`, `neq`). Records follow the account's record and field access, and
portals come as related sets. Nothing writes and nothing runs: `-new`, `-edit`,
`-delete` and `-dup` answer error 3, and a `-script` parameter error 960.

**How many people?** `node scripts/loadtest.ts <file.fmp12> --users 50` hosts
a copy of a file and has 50 simulated people browse, open, find and edit
records nonstop, each with live updates on, then reports response times.
When this was measured, on one CPU core, 50 such users on a real solution got answers in about
20 ms (2,200 requests a second); with a table padded to 100,000 records
(`--records 100000`), about 35 ms (1,270 a second): finds on text use a
word index. Those figures are from one development machine and the tests don't
repeat them; run the command on yours. Real people pause between
clicks, so a server handles many more of them than that.

**How fast on a big file?** `npm run bench` makes a synthetic file of 200,000
invoices and times opening it, finds, sorts, summary fields and ExecuteSQL;
[docs/performance.md](docs/performance.md) has the baseline and what it shows.

Add `--hot 3` to send every edit to the same three records, so people keep
running into each other, and check what matters under that: Data API
clients that don't lock add 1 to a number field with the record's `modId`
and retry when someone else saved first, and no increment may be lost;
every live-update stream must hear about every save; and no record may stay
locked after everyone signs out. CI runs this with 16 people, on one
process and on two (`--workers 2`, below).

**Does it hold up over time?** `node scripts/soak.ts <file.fmp12> --minutes 60`
has people come and go in waves for an hour: web client users with live
updates on, Data API clients, and people who drop mid-edit, leaving a lock
and a stream behind. After each wave the server reports its memory and
what it still holds. The checks: no sessions, record locks or live streams
are left once everyone is gone, and memory and open timers and sockets
level off rather than keep growing. Give `--script NAME` to run a script
too. One 15-minute run with 30 people (142,000 requests on Charts, on a development machine) left
nothing behind, and the server's memory settled at about 23 MB; the tests don't repeat it. CI runs a
short one when started by hand from the Actions tab. Data API clients that sign in and never sign out are cleared
15 minutes after their last request, as on FileMaker Server.

**Using every core.** Node runs a server's JavaScript on one CPU core.
`tabularius serve <folder> --workers auto` runs one process per core (or
`--workers 4`) behind the one port. People's sessions stay on the process
they signed in to. Record locks and live updates work across processes, and
so do closing, pausing and opening files. The admin console lists everyone,
and messages and disconnects them, whichever process they're on. Schedules,
backups, webhooks, the PostgreSQL port and the folder watcher run in one
process. HTTPS works too, automatic certificates included: the front process
gets and renews the certificate. So does encryption at rest: the first
process unlocks the files and locks them again once the others have let
go. Not yet combined with point-in-time backups or standbys. The admin <!-- known-difference: Server operation ;; Encryption at rest across several worker processes is not yet combined with point-in-time backups or standbys ;; The combination is not offered ;; An owner decision -->
console's slowest scripts and finds, and the metrics' request counts and
durations, add up every process's, as of a few seconds ago; the memory, CPU
and event-loop metrics are the first process's.
A process that stops is started again after a second; if it keeps stopping, or a start fails, the wait doubles each time (up to 30 seconds) and the start is tried again until it works, and a process that stays up for a minute starts the wait over.

## Privacy

Nothing leaves your computer unless you turn something on: no telemetry, no analytics, no update check, and no fonts or scripts from anyone else's server. [docs/privacy.md](docs/privacy.md) lists each thing that can be turned on, what it sends and when, and the tests that check the rest.

## How the format works

See [docs/research/fmp12-format.md](docs/research/fmp12-format.md) for what we
know, how we know it, and what's still open, and
[docs/research/prior-work.md](docs/research/prior-work.md) for sources.
[docs/research/write-back.md](docs/research/write-back.md) studies how design
changes made here could go back into a FileMaker file.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how changes are made here, or the [contributor summary](docs/contributing.md) for the pre-push check. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says.

## License

MIT. Parts of the decoder are derived from
[fmptools](https://github.com/evanmiller/fmptools) by Evan Miller (MIT); see
[NOTICE](NOTICE). The packages and the Node.js runtime inside a release build keep their
own licences, listed in the `THIRD-PARTY-NOTICES.md` that ships beside it;
`npm run licences` checks that every dependency's licence is on the allow list
and that no sample files or keys are committed. FileMaker is a trademark of Claris International Inc.; this
project is not affiliated with Claris.
