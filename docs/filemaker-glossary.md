# FileMaker glossary and menu map

This page explains FileMaker terms as Tabularius uses them and maps FileMaker menu paths, tools and habits to their Tabularius locations. Search this page for a term or menu name. The FileMaker-side menu names and behavior comparisons below are inferred unless a row links to a Claris source; Tabularius interface names are checked by the linked repository test. Unsettled behavior is listed in [known differences](known-differences.md). <!-- known-difference: Scripts and script steps ;; The FileMaker-side menu names and behaviour comparisons in the glossary are inferred unless a row links to a Claris source ;; A menu path or behaviour named in the glossary may differ from the FileMaker version in use ;; A FileMaker run or a Claris page for each row -->

## Glossary

| FileMaker term | Tabularius word | More information |
| --- | --- | --- |
| Account | Account | [Manage Security](for-filemaker-developers.md#where-is-each-thing) |
| Calculation | Calculation | [Calculations](design-mode.md) |
| Client | Client | [Web client](web-client.md) |
| Container field | Container field | [Containers](design-mode.md#containers) |
| Custom function | Custom function | [Custom functions](design-mode.md) |
| Database | Hosted file (database in routes) | [For FileMaker developers](for-filemaker-developers.md#words-that-mean-something-else-here) |
| Data API | Data API | [Data API compatibility](data-api-compatibility.md) |
| Extended privilege | Extended privilege | [Extended privileges](moving-a-solution.md#extended-privileges) |
| File | Source file or hosted file, as specified | [Moving a solution](moving-a-solution.md) |
| Hosting | `tabularius serve <folder>` | [For FileMaker developers](for-filemaker-developers.md#words-that-mean-something-else-here) |
| Layout | Layout | [Design mode](design-mode.md) |
| Layout Setup | Layout settings in the layout editor | [Web client](web-client.md#preview-mode-and-printing) |
| Manage Database | Design › Tables & fields and Design › Relationships | [Design mode](design-mode.md) |
| Privilege set | Privilege set | [Security defaults](security-defaults.md) |
| Script Debugger | Script Debugger | [Design mode](design-mode.md) |
| Script Workspace | Design › Scripts | [Script steps support](script-steps-support.md) |
| Server script | Server script | [Moving a solution](moving-a-solution.md#scripts-run-on-the-server-network-access-is-a-switch-you-turn-on) |
| Table occurrence | Table occurrence | [Design mode](design-mode.md) |
| Value list | Value list | [Design mode](design-mode.md) |
| WebDirect | Web client | [Web client](web-client.md#links-from-other-pages-and-systems) |

## Where is each thing?

| In FileMaker | Here | Status | Details |
| --- | --- | --- | --- |
| Manage Database: tables and fields | **Web client › File › Manage › Database…** opens **Design › Tables & fields** | Same | Field types, auto-enter, validation, indexes and storage options are there; Furigana is not. See [design mode](design-mode.md#field-options). |
| Manage Database: relationships (graph) | **Design › Relationships** | Same | The graph, its predicates and the table occurrences. `GET /tabularius/design/v1/databases/{database}/graph` returns it as data. See [design mode](design-mode.md). |
| Manage Layouts | **Web client › File › Manage › Layouts…** opens **Design › Layouts** | Same | New, duplicate, delete, reorder and edit layouts. See [design mode](design-mode.md). |
| Layout Setup | **Design › Layouts**, then Layout Setup in the layout editor | Same | Includes printing columns and the width at which a layout stacks on a phone, which FileMaker does not have. See [web client](web-client.md#preview-mode-and-printing). |
| Script Workspace | **Web client › Scripts › Script Workspace…** opens **Design › Scripts** | Same | Edit scripts step by step, or as text. See [design mode](design-mode.md#scripts-as-text). Steps that are not built answer error 3: [script steps support](script-steps-support.md). |
| Script Debugger | **Web client › Tools › Script Debugger** | Different | Steps, breakpoints and variables, but it runs on a throwaway copy of the file unless you choose otherwise. `POST /tabularius/debug/v1/databases/{database}/runs` starts a run; MCP tool `debug_script` does it for an AI app. See [design mode](design-mode.md). |
| Data Viewer | **Web client › Tools › Data Viewer** | Same | Evaluate a calculation and watch variables and globals. `POST /tabularius/debug/v1/databases/{database}/evaluate` is the same over HTTP. |
| Manage Security | **Web client › File › Manage › Security…**; `tabularius passwd`; `tabularius privileges` | Different | Accounts, privilege sets and extended privileges, and also a password policy, second factors, passkeys and API tokens. `POST /tabularius/security/v1/databases/{database}` changes them. Some custom privileges of a converted file are not carried over: [moving a solution](moving-a-solution.md) ("Things that don't work yet"). |
| Manage External Data Sources | **Design › Data sources** | Same | FileMaker file references with the same path forms. See [design mode](design-mode.md#external-data-sources). |
| Manage Value Lists | **Design › Value lists** | Same | See [design mode](design-mode.md). |
| Manage Custom Functions | **Design › Custom functions** | Same | See [design mode](design-mode.md). |
| Manage Custom Menus | **Design › Custom menus** | Same | See [design mode](design-mode.md). |
| Manage Themes | **Design › Themes** | Different | A theme is CSS rules per object part and state, not a FileMaker theme file. See [design mode](design-mode.md#themes-and-styles). |
| Manage Containers | **Design › Containers** | Different | Base directories and which fields store externally are kept; secure (encrypted) external storage is not supported yet. See [design mode](design-mode.md#containers). |
| Container storage on the server | `tabularius migrate-fms`; `GET /tabularius/admin/v1/files/{name}/external-containers` | Different | Open storage is read from and written to `RC_Data_FMS/<file>/` (or `Files/<file>/`) next to the hosted file, as FileMaker keeps it. Secure storage cannot be read from a converted file. See [moving a solution](moving-a-solution.md#container-files). |
| Database Design Report | **Design › Report**; `GET /tabularius/design/v1/databases/{database}/ddr`; `tabularius ddr` | Different | Writes FileMaker's Design Report XML for the tools that read it; object formatting and theme CSS are left out. `tabularius ddr` reads a `.fmp12`. See [design mode](design-mode.md#database-design-report). |
| Perform Script on Server | The step itself, in a script; `GET /fmi/data/{version}/databases/{database}/layouts/{layout}/script/{script}` from outside | Same | Runs in a fresh session as the caller's account, as on FileMaker Server. See [moving a solution](moving-a-solution.md#perform-script-on-server-works-as-on-filemaker-server). |
| Schedules in the Admin Console | **Console › Script schedules**; `GET /tabularius/admin/v1/schedules` | Different | Script and backup schedules work, also through FileMaker's Admin API (`GET /fmi/admin/api/v2/schedules`). Verify and system-script schedules are not supported and answer code 21. See [the Admin APIs](../ADMIN.md#the-admin-apis). |
| Backups of the hosted files | `tabularius backup`; `tabularius verify-backup`; `tabularius restore` | Different | Backups run daily unless told not to, are checked, and can be put back as they were at a moment. See [backup and restore](tutorials/backup-and-restore.md). |
| `fmsadmin` / `fmcsadmin` | `fmcsadmin` against `/fmi/admin/api/v2`; the server's own commands such as `tabularius serve` | Different | Most `fmcsadmin` commands were run against Tabularius; [the parity table](fmcsadmin-parity.md) says which. The name of the command-line tool differs between FileMaker Server versions; use the one your version's Claris documentation names. |
| Data API | `POST /fmi/data/{version}/databases/{database}/sessions`; `POST /fmi/data/{version}/databases/{database}/layouts/{layout}/_find` | Same | The same routes, bodies and error codes; an account needs the `fmrest` extended privilege. Where an answer has not been compared with FileMaker's, [Data API compatibility](data-api-compatibility.md) says so. |
| OData | `GET /fmi/odata/v4/{database}/{entitySet}` | Same | Needs `fmodata`. |
| ExecuteSQL | The `ExecuteSQL` function in a calculation; `POST /tabularius/sql/v1/databases/{database}`; `tabularius serve --sql-port` | Same | The function follows FileMaker's grammar ([SQL grammar conformance](sql-grammar-conformance.md)); a few edge cases have not been compared with FileMaker, listed under SQL and calculations in [known differences](known-differences.md#sql-and-calculations). The SQL port is new: BI tools and PostgreSQL drivers connect to it with `fmxdbc`. |
| WebDirect | **Web client** at `/app/`; `GET /fmi/webd/{database}` | Different | The web client is the only client; there is no FileMaker Pro. A WebDirect link opens it, and `fmurlscript` lets a link run a script. See [web client](web-client.md#links-from-other-pages-and-systems). |
| Claris Connect | `POST /tabularius/admin/v1/webhooks`; `POST /tabularius/admin/v1/inbound-hooks` | Missing | The script step Trigger Claris Connect Flow answers error 3. Webhooks send record changes out and inbound hooks let outside calls run scripts. FileMaker's Admin API works, but Claris Connect's connector has not been tried against it. See [script steps support](script-steps-support.md). |
| Plug-ins | **Console › Plug-ins**; `tabularius plugins` | Different | FileMaker plug-ins (`.fmplugin`) are not loaded. The BaseElements and MBS functions that are safe on a server are built in; others answer `?` and error 3. Tabularius's own plug-ins are `.ohplugin` packages. See [plug-in compatibility](plugin-compatibility.md) and [writing a plug-in](writing-a-plugin.md). |
| Save a Copy as… (Clone) | The script step Save a Copy as, with the clone choice | Different | The copy is a `.openhbam.sqlite` file, not a `.fmp12`, and the step needs full access because the copy exposes everything. See [moving a solution](moving-a-solution.md#the-store-is-not-the-fmp12). |
| Recover | `tabularius verify-backup`; `tabularius restore`; `tabularius doctor` | Missing | There is no Recover File: a hosted file is an SQLite database that is checked with each backup, so keep backups and put one back. See [backup and restore](tutorials/backup-and-restore.md). |
| Import Records, Export Records | **Web client › File › Import Records…**, **Web client › File › Export Records…**; `tabularius import-tables` | Same | `tabularius import-tables` brings in Airtable, Notion, Google Sheets and Excel data as new tables. See [moving in from other tools](moving-in-from-other-tools.md). |
| Taking a design change back to FileMaker | `tabularius write-back` | Different | A converted file cannot be written back to `.fmp12`. The command writes clipboard XML to paste in FileMaker Pro and a list of what to do by hand. See [the store is not the .fmp12](moving-a-solution.md#the-store-is-not-the-fmp12). |
| Asking an AI about your solution | MCP tool `explain_solution` | Different | New in Tabularius: AI apps connect at `/mcp` and work within an account's privilege set. See [connect an AI app](connect-ai.md). |

## Behavior and compatibility

The menu map reports how the existing interface and commands are implemented. Where behavior has not been compared with a FileMaker run, consult [known differences](known-differences.md), which records the unsettled behavior and what would settle it.
