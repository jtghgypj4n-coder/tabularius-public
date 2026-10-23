# Moving a solution to Tabularius

This guide is for FileMaker developers who already know their way around
FileMaker Pro and FileMaker Server. It covers getting Tabularius running,
hosting your `.fmp12`, carrying over accounts and privilege sets, the AI
tools that come with it, and the places where Tabularius behaves differently
from FileMaker. [Known differences](known-differences.md) lists them all in
one place, with what is still unknown.

For a first try on your own computer, [QUICKSTART.md](../QUICKSTART.md) is
shorter, and [Move a FileMaker file in](tutorials/move-a-file-in.md) is a
short, tested walk through the first steps with one file. For running a server for a team (upgrades, backups, certificates,
the Admin APIs), see [ADMIN.md](../ADMIN.md). Every command here is listed
by `tabularius --help`.

In the commands below, `<folder>` is the folder Tabularius hosts and
`<database>` is a hosted file's name without `.fmp12` (`Invoices`, not
`Invoices.fmp12`).

## 1. Install

You need one of these:

- **The single-file program** for macOS, Linux or Windows, from the build
  artifacts of the release workflow. Nothing else to install. On macOS and
  Linux, make it runnable first: `chmod +x tabularius-*`.
- **This repository.** Run `./scripts/install.sh` on macOS or Linux, or
  `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` on Windows.
  Each downloads Node 22.20 into `~/.openhbam/node` if you don't have it,
  and adds a `tabularius` command. On macOS and Linux it goes in
  `~/.local/bin`, and the script tells you if that folder isn't on your
  PATH.
- **Docker.** `docker compose up -d` hosts `./Databases` on port 8080 (the README's Docker steps make the folder writable for the container and set the passwords).

Check it works:

<!-- docs-example: run -->
```sh
tabularius --help
```

## 2. Look at the file before you host it

These commands read a `.fmp12` directly. They change nothing and need no
server:

<!-- docs-example: placeholders {"Invoices.fmp12 Customers": "Invoices.fmp12 \"NW Customers\"", "Invoices.fmp12": "fixtures/fmp12/Charts.fmp12", "./data": "~/Databases"} -->
```sh
tabularius info Invoices.fmp12            # file header and object counts
tabularius schema Invoices.fmp12          # tables, fields, layouts, scripts, ... (--json for JSON)
tabularius records Invoices.fmp12 Customers --limit 5
tabularius schema ./data Invoices         # the same two commands read a hosted database: folder, then name
tabularius records ./data Invoices Customers --limit 5
tabularius ddr Invoices.fmp12 > Invoices.xml   # a Database Design Report (FMPReport XML)
```

`tabularius ddr` gives the same FMPReport XML that FileMaker's Database Design
Report writes, so analysis tools that read a DDR can read it too.

A file encrypted with FileMaker's Encryption at Rest needs its passphrase.
Each of these commands asks for it in the terminal (or reads
`TABULARIUS_SOURCE_PASSPHRASE`).

## 3. Host the file

Tabularius hosts a **folder**. Each `.fmp12` in it is converted once into
Tabularius's own store, `<name>.openhbam.sqlite`, next to it. The `.fmp12` is
left as it is. From then on, everything people change is in the store, not
in the `.fmp12`.

The quickest way:

```sh
tabularius
```

This hosts `~/tabularius` (set `TABULARIUS_FOLDER` for another folder) for this
computer only, and opens the admin console in your browser. Drop a `.fmp12`
on the page and it is converted, hosted and opened in the web client.
Tick **After it's hosted, offer to make modern list and detail layouts** first
if you want new layouts beside the file's own: once you sign in, Manage
Layouts opens on **Modernize interfaces**, which previews them and makes them
only when you say so. It uses templates, so no AI and no tokens (see
[Modernize interfaces](design-mode.md)); you can do the same later from
Manage → Layouts.

To host a folder yourself:

<!-- docs-example: illustrative -->
```sh
tabularius serve ~/Databases --port 8080
```

Copy `.fmp12` files into the folder, even while the server runs. Each one
appears within a few seconds. The server prints where everything is:

| Address | What it is | FileMaker equivalent |
| --- | --- | --- |
| `/app/` | The web client: your layouts in a browser | FileMaker Pro, WebDirect |
| `/admin/` | The admin console | FileMaker Server Admin Console |
| `/fmi/data/vLatest` | The Data API | FileMaker Data API |
| `/fmi/odata/v4` | OData | FileMaker OData API |
| `/fmi/xml/fmresultset.xml` | Legacy XML, reads only (also `FMPXMLRESULT.xml`, `FMPXMLLAYOUT.xml`) | Custom Web Publishing with XML |
| `/fmi/admin/api/v2` | The Admin API | FileMaker Server Admin API |
| `/mcp` | The MCP server, for AI apps | (none) |

To let other computers connect, add `--host 0.0.0.0` with HTTPS (`--https local` on a local
network), and set the admin console's password first. The console has no user name, and its password is
not a FileMaker account:

<!-- docs-example: illustrative -->
```sh
tabularius admin-password ~/Databases
tabularius serve ~/Databases --host 0.0.0.0 --https local
```

To keep it running, install it as a service. It starts at sign-in, or at
boot with `--system`. Options after `--` go to `tabularius serve`:

<!-- docs-example: illustrative -->
```sh
tabularius service install ~/Databases --system --port 8080 --host 0.0.0.0 -- --https local
```

`--https local` serves HTTPS with the server's own certificate, for a local
network. For a public name, `--https files.example.com` gets a certificate
from Let's Encrypt. [ADMIN.md](../ADMIN.md) covers certificates, backups,
upgrades and using every CPU core.

### Coming from FileMaker Server

`tabularius migrate-fms` brings FileMaker Server's hosted files, their
externally stored container folders, script schedules, backup schedule and
SSL certificate into a Tabularius folder. Try it with `--dry-run` first:

<!-- docs-example: illustrative -->
```sh
tabularius migrate-fms /srv/Databases --fms-dir "/Library/FileMaker Server" --from https://localhost --insecure --dry-run
```

[ADMIN.md](../ADMIN.md#moving-from-filemaker-server) explains each option
and what does and doesn't come over.

### Container files

Container data embedded in the file comes over with it. Containers stored
outside the file (open storage) are read from `RC_Data_FMS/<name>/` (as
FileMaker Server keeps them) or `Files/<name>/` (as FileMaker Pro keeps
them), next to the hosted file. `migrate-fms` copies them for you. Secure
(encrypted) external storage can't be read yet.

For storage on another volume, an operator can make a directory symlink below
`RC_Data_FMS/<name>/` or `Files/<name>/` before opening the hosted file. The
server records those existing directory links when it opens the file and uses
them for container reads and writes. Links added later, links to individual
container files, and links named by container data are refused.

### What won't work yet

Before you invite anyone in, run:

<!-- docs-example: run -->
```sh
tabularius report ~/Databases Invoices
```

It lists what in the file won't work yet: script steps, functions,
plug-ins, other files, accounts. The admin console shows the same after each
upload. Two more checks are useful for a solution with a lot of logic:

<!-- docs-example: run -->
```sh
tabularius test-scripts ~/Databases Invoices          # run each script offline; list the ones that stall, crash or error
tabularius fidelity ~/Databases Invoices              # recompute stored calculations and compare with FileMaker's values
```

`test-scripts` runs every script on its own, offline (no network, mail or
plug-ins), and undoes each script's changes. `fidelity` reports counts only,
never values, and runs no scripts.

The admin console also lists the file's plug-in calls on their own. After a
file is hosted, and in the first-run checklist, it says in one line how many
plug-in functions will not run ("3 plug-in functions will not run"); press
**See which**, or **Plug-ins** beside the file under Hosted files, for the list.
Each function shows whether it runs here, gives `?`, gives an MBS error text or
goes to the Outbox (only inside a script, with the server started with
`--test-outbound`), how many scripts, calculations and layout objects call it
(each counted once), and what to use
instead. **Download as CSV** saves the same list: function names and counts
only, never records or the names of your scripts and fields. Only the admin
sign-in opens it. A call whose MBS function is named while the calculation runs is
listed as "Can't tell", because the file does not say which function it is.
The AI tool `migration_plan` reads the same list and proposes the rewrites.

### Making the file smaller and faster

<!-- docs-example: placeholders {"~/Databases/Invoices.fmp12": "fixtures/fmp12/Charts.fmp12"} -->
```sh
tabularius optimize ~/Databases/Invoices.fmp12      # before converting: reads the file, hosts nothing
tabularius optimize ~/Databases Invoices            # a file already hosted
```

It looks at the converted file and says what would make it smaller or faster,
worst first, each with what it would save:

- **Container files kept inside the file.** The usual reason a database is
  huge: pictures, PDFs and other files, sized field by field, with how much of
  the file they are. Moving them to S3-compatible storage (keeping only a link
  in the record) or to external storage shrinks the file by that much and
  speeds up backups. Small binary values such as AI embeddings are left out:
  they are data for search, not files anyone opens.
- **Pictures far bigger than they are shown.** Where a layout draws a
  container field small, the report counts the pictures with at least twice
  the pixels that layout can use and estimates (a guess from pixel counts, so it
  says "about") what shrinking them would save.
- **Sorts, finds and matches that no index can serve** in tables of a thousand
  records or more: an unstored calculation or summary field used as a key (it
  says whether the calculation could simply be stored), and a stored field with
  no index (one click adds the index in the admin console).
- **Things nothing uses:** fields, scripts, table occurrences and value
  lists that appear nowhere (they may still be used from outside the file, so
  check before removing any).
- **What the records hold.** Text fields with 5 MB or more in them (pictures
  and files written into text as `data:` addresses are container files in
  disguise, and are called out as such), and stored fields that are empty in
  every record of a table with a thousand records or more. This is read from
  the records, one pass over each table.
- **Layouts that show unstored calculations over a big table.** A layout of a
  table with 10,000 records or more that puts unstored calculations or summary
  fields of that table on it: each is worked out again for every record drawn.
- **Shapes that cost time:** very wide tables, repeating fields, very long
  typed-in value lists, value lists over a big unindexed table, summary fields
  in a table of 50,000 records or more.

Dropping a file on the admin console's welcome page shows the report as soon as
the file is hosted. When something is high impact (usually container files
stored inside the file) the page waits for you to press **Open** instead of
rushing on to the web client; a lean file opens at once.

The report changes nothing. A finding that has an action says so; the action
runs only when you press its button (Hosted files, **Optimize**) or send its
request, and the admin console says what it does first. MCP clients and the
assistant get the same report from `optimization_report`.

**Moving container files to managed external storage** is a button on the
finding. It writes each file the field keeps inside the database into the
field's folder beside the hosted file (`RC_Data_FMS/<file>/<Table>/<Field>/`),
sets the field to store its files outside the file if it didn't (a design
change), and then rewrites the database so it gives the space back. It is all
or nothing, the records keep pointing at the same files, and the report lists
the move with **Put them back**. From then on that folder has to be backed up
along with the file. An MCP client does the same with
`optimization_move_containers` (describes first, changes nothing until
`confirm: true`; full access only). Moving them to S3 and keeping only a link
is described but not available yet: the server reads container files from
local folders, so a link needs a decision about reading them from storage.

Some findings offer a fix to the file's design:

- hide or remove the scripts nothing runs (hiding keeps them in the file and
  takes them off the Scripts menu; they can still be run by name),
- remove the value lists and the table occurrences nothing uses,
- store an unstored calculation that a sort depends on, when its formula reads
  only its own table and nothing that changes by itself.

Pressing **Do it** first shows, name by name, exactly what will happen, and
nothing changes until you accept. A fix is one change: all of it is made or
none, and the report then lists it under **Changes made from this list** with
an **Undo** that puts back exactly what it took out, where it was, along with
the privilege-set entries for it. Anything changed since is left alone, and an
undo that something now stands in the way of (a script of the same name was
made) changes nothing and says why. MCP clients use `optimization_fix`, which
only describes the change until it is sent `confirm: true`.

### Converting again

If you change the solution in FileMaker after converting it, or a later
version of Tabularius converts something better, convert again:

<!-- docs-example: illustrative -->
```sh
tabularius reconvert ~/Databases Invoices --dry-run
tabularius reconvert ~/Databases Invoices
```

This keeps records created, changed and deleted since the first
conversion, as well as accounts and settings. The previous store is kept
beside the new one.

### Dates in the file

A `.fmp12` file stores dates as text in the order its creator's computer used, and does not say which. Tabularius
reads the order from the dates themselves: a date with the year first, or a day above 12, settles it, and the
timestamps count too. It looks at the first 200 records of each table. When no date settles it (every date reads either
way, or day and month are the same), it reads them month first, as earlier versions did.

If two dates settle opposite orders (`13/04/2025` and `04/13/2025`), the file is not converted: the message names both
dates, with their table, field and record. Correct the date that is wrong in the source file and convert again.
Earlier versions took whichever date came first. There is no setting to state the order yourself yet.

## 4. Accounts and privilege sets

Accounts and privilege sets come over with the file. Every way in enforces
them: the web client, the Data API, OData, SQL, scripts and AI apps.

- Records an account can't view are left out of found sets.
- Fields it can't see are left out.
- Writes it isn't allowed fail with FileMaker's errors (200, 201).

See what came over:

<!-- docs-example: run -->
```sh
tabularius privileges ~/Databases Invoices
```

### Passwords

Tabularius can't check FileMaker's non-empty passwords yet. Each account
that had one needs a new password set here before it can sign in:

<!-- docs-example: placeholders {"Ann": "Admin"} -->
```sh
tabularius passwd ~/Databases Invoices Ann
```

It asks for the password twice, hidden. In a script, set
`TABULARIUS_PASSWORD` instead. `--must-change` makes the person choose a new
one at their next sign-in.

An account whose FileMaker password was empty (often `Admin`) signs in with
that empty password, but only from the server's own computer. To allow it
from other computers, start the server with `--allow-blank-passwords`. It's
better to give the account a password.

To add an account, set its password and give it a privilege set:

<!-- docs-example: placeholders {"[Data Entry Only]": "Staff"} -->
```sh
tabularius passwd ~/Databases Invoices Ben --privilege-set "[Data Entry Only]"
```

### Extended privileges

As on FileMaker Server, each way in needs an extended privilege:

| Keyword | Lets the account use |
| --- | --- |
| `fmapp`, `fmwebdirect` | the web client |
| `fmrest` | the Data API |
| `fmodata` | OData (Excel, Power BI) |
| `fmxml` | legacy XML (`/fmi/xml`), reads only |
| `fmxdbc` | SQL (`serve --sql-port`), like ODBC/JDBC |
| `fmurlscript` | running a script from a link (`/fmi/webd/<file>?script=…`), as in WebDirect |
| `fmmcp` | AI apps (MCP) and the AI assistant. New in Tabularius; `[Full Access]` always has it |

FileMaker leaves `[Full Access]` without these. So when a file is first
hosted here, its `[Full Access]` gets `fmapp` and `fmrest`, and the file's
administrator can sign in straight away. Grant or revoke the others:

<!-- docs-example: placeholders {"[Data Entry Only]": "Staff"} -->
```sh
tabularius privileges ~/Databases Invoices grant "[Data Entry Only]" fmapp
tabularius privileges ~/Databases Invoices revoke "[Data Entry Only]" fmrest
```

### Custom privileges

Tabularius reads each privilege set's overall access from the file: records
(view, create, edit, delete), all layouts, all value lists, all scripts, its
extended privileges and its comment. "Allow printing", "Allow exporting",
"Allow user to modify their own password" and "Disconnect user from
FileMaker Server when idle" come across too. Printing being off stops the
Print and Save Records as PDF steps; a browser can always print the page it
shows.

Of FileMaker's **Custom privileges**, per-table record access and per-field
access come across, failing closed: a table the set doesn't list gets no
access, and in a table whose fields the set customises, a field is kept
only when the file marks it read/write. Any other field of that table,
view-only ones included, is hidden until you grant it, since
which value means view-only is inferred. `tabularius report` lists those <!-- known-difference: Reading .fmp12 files ;; Which field byte value means view-only is inferred; in a table whose fields a set customises, a field not marked read/write is hidden until granted ;; Those fields are hidden; tabularius report lists them for each set ;; More sample files with view-only fields, or a Claris statement of the byte -->
fields for each set.

Still not read from the file:

- per-layout, per-value-list and per-script access. No sample file shows how
  FileMaker marks a per-layout choice. Every sample stores one of four bytes
  for layouts, value lists and scripts (modifiable or view only); a set
  whose bytes are anything else, or whose block holds more than those three
  values, comes across with no access to them and the report says so;
- the "Available menu commands" option, which comes across as All;
- record access limited by a calculation ("limited..." in Edit Privilege
  Set). No sample file has one, and the samples hold only three
  record-access values (everything, view only, nothing). Any other value
  comes across as view only at most, because which bit means create, edit
  or delete is itself inferred, and the report names the set. Check the
  tables where you used it. <!-- known-difference: Reading .fmp12 files ;; Which record-access bit means create, edit or delete is inferred, and no sample has record access limited by a calculation ;; Only the bytes the samples hold are read in full; any other comes across as view only and is named by tabularius report ;; More sample files with limited or mixed record access -->

Other things that are not in a form some sample file shows come across the
careful way and are named by `tabularius report` under the set or account:
"other options" of another length (printing, exporting and password change
off, idle disconnect on), a set whose name another set already has (it is
renamed and keeps its access), an account whose privilege-set id is not
written the way every sample writes it (it gets no set and cannot sign in
until you give it one), and an `fmmcp` extended privilege, which is
Tabularius's own and so not one a FileMaker file can have (it is not
imported). This is what the nine sample files show, not a statement about
every file FileMaker can make.

`tabularius report` warns about this for every file with sets of its own.
**Review every set you made yourself before people sign in.**

You can rebuild them in two ways:

- **In the browser:** the web client's **Manage Security** (full access
  only) edits accounts and privilege sets, including record access per
  table with record-level calculations, and field, layout, value list and
  script access.
- **As JSON:**

  <!-- docs-example: placeholders {"[Data Entry Only]": "Staff"} -->
  ```sh
  tabularius privileges ~/Databases Invoices show "[Data Entry Only]" > set.json
  # edit set.json
  tabularius privileges ~/Databases Invoices save set.json
  tabularius privileges ~/Databases Invoices account Ben "[Data Entry Only]"
  ```

  A record-level limit is a calculation, as in FileMaker. Each table gives
  `view`, `edit` and `delete` (true, false or a calculation) and `create`
  (true or false):
  `"tables": {"Invoices": {"view": "Owner = Get ( AccountName )", "edit": "Status ≠ \"Paid\"", "delete": false, "create": true}}`.

Scripts run within the account's privileges too. A script set to "Run
script with full access privileges" runs with full access, as in FileMaker.

### More sign-in options

These have no direct equivalent in a FileMaker file. The
[README](../README.md) has the details.

- **Password rules:** `tabularius privileges ~/Databases Invoices policy 12 90`
  sets a minimum length of 12 and a maximum age of 90 days. Use 0 to turn a
  limit off. A file with no policy of its own already needs 12 characters for a
  new password.
- **Two-factor sign-in:** `tabularius totp ~/Databases Invoices enroll Ann`,
  then `confirm Ann <code>`.
- **API tokens for integrations**, instead of a stored password:
  `tabularius token ~/Databases Invoices create Ann --read-only --expires-days 90`.
  The token is shown once. `token ... list` and `token ... revoke <id>`
  manage them.
- **Identity providers** (OpenID Connect, LDAP, Active Directory), like
  FileMaker's external accounts:
  `tabularius privileges ~/Databases Invoices external "Sales" "[Data Entry Only]"`
  gives everyone in the group Sales that privilege set. Start the server with
  `--oidc-issuer` and `--oidc-client-id`, or with `--ldap-url`.
- **Lockout:** after five wrong passwords in 15 minutes from one address,
  that address can't sign in to the account for 15 minutes. Other addresses
  still can. An address that gets 30 passwords wrong across any account names
  in 15 minutes (password spraying) is blocked from every account for
  15 minutes, with a Retry-After. Passkey and recovery-code failures count too. Everyone behind
  the same address (an office NAT) shares that budget, so an administrator can lift
  it with the unlock call's `address` option. This computer's own addresses are exempt.

## 5. The AI tools

Tabularius has two kinds of AI tools. Both act as an account of the file and
can do only what its privilege set allows.

### AI apps (MCP)

The server includes an MCP server at `/mcp`. Claude Desktop, Claude Code and
other MCP clients can work with a hosted file through it. It includes
tools for both data and design:

- **Data:** `find_records`, `search_records`, `semantic_find` (only with an
  embedding model, `--ai-embed-url`), `get_record`, `create_record`,
  `update_record`, `summarize_records`, `run_script`
- **Understanding a solution:** `explain_solution`, `document_solution`,
  `where_used`, `search_solution`, `check_change_impact`, `explain_value`,
  `explain_related`, `conversion_report`, `conversion_guide`
- **Checking drafts:** `check_calculation`, `check_script`, `lint_formulas`,
  `debug_script` (offline), `try_design_change` (on a throwaway copy)
- **Moving code between FileMaker and Tabularius:** `paste_from_filemaker`,
  `copy_for_filemaker`, which read and write FileMaker clipboard XML

To connect an AI app, open the admin console, go to **Connect an AI app**,
pick the file and an account, and press **Make a token**. The page gives you
settings to paste into Claude Code, Claude Desktop or other clients.
[connect-ai.md](connect-ai.md) walks through it.

For a desktop AI app on the same computer, `tabularius mcp` speaks MCP over
stdio. With `--account`, and that account's password in
`TABULARIUS_PASSWORD`, the AI works within the account's privilege set.
Without an account, it acts as the server administrator.

<!-- docs-example: illustrative -->
```sh
TABULARIUS_PASSWORD=... tabularius mcp ~/Databases --account "AI Helper"
```

The account needs the `fmmcp` extended privilege.

### The AI assistant

Start the server with `--ai` to turn on the assistant in the web client and
design mode. It needs an Anthropic API key in `ANTHROPIC_API_KEY`, in the
file `~/.openhbam/anthropic-key` (chmod 600), or in a file named with
`--ai-key-file`. A key made outside a workspace also needs its workspace ID,
with `--ai-workspace-id wrkspc_…` or in `~/.openhbam/anthropic-workspace-id`.
The assistant can:

- answer questions about a file, layout or record
- explain or draft calculations and scripts
- turn a sentence into find requests
- draw charts and dashboards
- find duplicate or malformed data
- explain why a script failed, by running it again on a throwaway copy

Three options cap its use: `--ai-daily-tokens N` per day for the whole
server, `--ai-account-daily-tokens N` per account per day, and
`--ai-monthly-budget D`, which stops it at about D US dollars a month.

With `--ai`, FileMaker's AI script steps (Configure AI Account, Generate
Response from Model, Perform Find by Natural Language and others) run on
the server's model. The key and endpoint a script configures are never used.

### Keeping a file away from AI

To make sure no AI app or assistant reads a file, for any account:

<!-- docs-example: placeholders {"Payroll": "Invoices"} -->
```sh
tabularius ai ~/Databases Payroll off
tabularius ai ~/Databases Payroll status
```

Or start the server with `--ai-exclude Payroll`, or use the AI column of
Hosted files in the admin console. A file that uses Payroll's tables is
kept from AI too. Each change of the setting, and each refused request, is
written to the file's security log.

Some protections are always on:

- Scripts an AI app runs never send mail or reach the network, whatever the Script network switch says.
- AI apps never see the values of fields whose names mark them as secrets,
  such as Password, API Key, Access Token, Secret or Credential. A field
  named only "Key" isn't hidden, so rename it or keep the file
  away from AI.

## 6. What differs from FileMaker

### There is no FileMaker Pro client

People use the web client in a browser. Layout design, scripts and schema
changes happen in Tabularius's design mode, also in the browser (see
[design-mode.md](design-mode.md)). [web-client.md](web-client.md) lists
what the web client does in Browse, Find and Preview mode, and what it
doesn't yet.

### The store is not the .fmp12

Once a file is converted, its records live in `<name>.openhbam.sqlite`, an
SQLite database. Tabularius can't yet write a `.fmp12` back, so a change made
here can't be opened in FileMaker Pro. To bring a design change made in
FileMaker into Tabularius, use `tabularius reconvert`.

### Scripts run on the server; network access is a switch you turn on

Scripts run on the server, as FileMaker Server runs them.

- **Network.** Steps that reach the network (Insert from URL and similar) work
  once you turn on **Script network** for the file in the admin console (Hosted
  files), or start the server with `--allow-script-network` to turn it on for
  every file. It starts off for every converted file and for `tabularius demo`,
  so a copy you are testing cannot call outside services; the admin console and
  the web client say so, and a script that tries gets error 3 with the steps to
  turn it on. Turn it on when this copy is the live one. Even then a script
  cannot reach this machine's own network (loopback, 10.x, 192.168.x and so on)
  unless `--allow-script-network-to` lists the host or range, and never a
  link-local or cloud metadata address: see
  [Outbound requests](outbound-requests.md).
- **Mail.** Send Mail is sent once the server is set up to send it (an email
  connection or `--send-mail`); until then it is not sent.
- **Scripts an AI app runs** are always offline.
- **Scheduled scripts, automations and inbound hooks** follow the file's switch
  and also need their own network option.
- **Screen-only steps** are skipped on the server, as on FileMaker Server.
- **FileMaker Pro–only steps** (a person choosing a file, AppleScript)
  give error 3, as on FileMaker Server.
- **Import Records** reads files only from `<folder>/Documents`.

To try a script's mail and web calls safely, start the server with
`--test-outbound`. Every message goes to `<folder>/Outbox` instead of its
recipients.

A file can be marked **capture-only** when its mail and web calls must never
get out, whatever the server allows (a client's solution you are testing, say).
Name such files with `--capture-only NAME[,NAME]` or the environment variable
`TABULARIUS_CAPTURE_ONLY` (comma-separated; each name matches any file whose name
starts with it). Their scripts never reach the network or AI, send mail, run
on a schedule, or run automations and inbound hooks, and mail from them only
reaches the Outbox. No file is capture-only unless you name it.

### Plug-ins are not loaded

The full list of what runs and what gives "?" is in [plugin-compatibility.md](plugin-compatibility.md), generated from the code.

Safe, local BaseElements functions (JSON, regular expressions, stacks, text
files in `<folder>/Documents`) run natively. BaseElements' web calls
(`BE_HTTP_GET`, `POST`, `PUTData`, `PATCH`, `DELETE`, with `SetCustomHeader`,
`ResponseCode` and `ResponseHeaders`) and `BE_SMTPSend` work once **Script
network** is turned on for the file, through the same guarded transport as
Insert from URL (and, for mail, once the server is set up to send it); with the
switch off they give "?" and error 3, and with `--test-outbound` they go to the
Outbox instead. Turning on **Script network** also lets that file's scripts send
mail through `BE_SMTPSend`, once the server is set up to send it. Call these
functions from a script step (Set Variable, for example): inside a custom
function they give an empty result and error 3 even with the switch on.
`BE_HTTP_GET_File` (and `BE_HTTP_GETFile`, `BE_SaveURLToFile`) saves the answer,
byte for byte, to a path in the Documents folder, and `BE_HTTP_PUTFile` sends a
file from there (up to 10 MB); both take `http` and `https` addresses only. A
failing answer (a 4xx or 5xx status) is saved or returned like any other, with error
0, so check `BE_HTTP_ResponseCode`. The Documents folder belongs to the server, not
to one file: with Script network on, a file's scripts can send any file in it,
including an export another file's script left there. MBS
`CURL.Perform` follows the same switch. `BE_FTP_Upload`, `BE_FTP_UploadFile` and
`BE_FTP_Delete` work over `ftp://` and `ftps://` addresses (TLS from the start,
certificate checked) the same way; plain FTP sends the password in the clear, so
prefer `ftps://`. They never connect to an address the server's reply names, only
the one the first connection reached. `sftp://` addresses, which run over SSH,
are not built in <!-- known-difference: Vendor plug-ins ;; BaseElements' FTP functions work over ftp and ftps only: sftp is not built, and the error numbers (curl's 7, 35, 67, 25 and 21) and the upload and delete path rules follow BaseElements' documentation without a run of the plug-in ;; A script that uses an sftp address gets ? and error 3; one that tests for another error number can behave differently ;; A run of the real plug-in against an FTP and an SFTP server -->, and neither are the `ftp`, `ftps` and `sftp` addresses
`BE_HTTP_GET_File` takes in BaseElements: those give "?" and error 3. Shell and
clipboard calls are not built in either. <!-- known-difference: Vendor plug-ins ;; BaseElements' web calls answer with the body as text (BaseElements answers with a container), and the error number a failed request sets (7) is inferred ;; A script that reads the container or tests for another error number can behave differently ;; A run of the real plug-in against a failing address --> Of MBS, the `Text.*`
functions run natively, following MBS's own documentation: case, trimming,
lists and words, Base64, hex, URL, quoted-printable, HTML and XML encoding in
the text encoding you name (UTF-8, UTF-16, Latin-1, Windows, Mac, Hex,
Base64; "Native" is Mac Roman on a Mac, Windows-1252 on Windows and UTF-8 on
Linux), accents, Soundex, string distances and MIME types. Not yet: <!-- known-difference: MBS plug-in functions ;; Text.AddLineNumbers, Text.SoundExGerman, the styled-text, file and container functions and the DOS encoding are not available ;; The call gives ? and error 3 ;; Owner decision on whether to build them, and MBS documentation or samples -->
`Text.AddLineNumbers`, `Text.SoundExGerman`, the styled-text, file and
container ones, and the DOS encoding. MBS's `RegEx.*` functions run too
(Compile, Execute, Substring, Results, Replace, ReplaceAll, Extract, Match,
FindMatches, Quote and the rest), with MBS's option names and numbers.
Patterns are PCRE; Tabularius translates them for JavaScript's engine and
refuses, with an MBS error, what that engine can't do: atomic groups,
possessive quantifiers, recursion, conditionals, `\G`, `\K` and the
Partial, NotBOL, NotEOL, FirstLine and AutoCallout options, and caseless
`\p{Lu}`, `\p{Ll}` and `\p{Lt}` (JavaScript would let them match either
case). A compiled expression lasts for the person's session (for AI clients,
the account's); one session can hold 1,000. JavaScript's engine has no match limit
as PCRE does, so Tabularius gives every regular expression a time limit instead:
a pattern that backtracks without end, such as `(a+)+$` on a long run of a's,
is stopped after half a second (half a second for all the expressions in one
MBS call) with an MBS error, and `BE_RegularExpression` and
`BE_ReadTextFile`'s delimiter give "?" and error -1. It can't hold up the
server's other work.
`RegEx.DataDetector` (Apple's data detectors) is not available.

MBS's `JS.New`, `JS.Evaluate`, `JS.EvaluateToString`, global-property calls,
and `JS.Release` (`JS.Free`) use persistent, isolated JavaScript contexts.
They work in scripts. A calculation that has no script session (a stored
calculation, the MCP `evaluate_calculation` tool, a formula preview) gets
`[MBS] ERROR: JavaScript handles are only available in a script`, because
nothing there would end a handle.
Each session can hold eight handles; each server process can hold 32 across
all sessions. At global capacity, `JS.New` returns
`[MBS] ERROR: JavaScript context limit reached for this server (32)` without
creating a handle. A handle expires after **60 seconds idle**, measured from
creation or the end of its latest sandbox call using elapsed time, unaffected
by system-clock changes. This includes handles never evaluated. Expiry stops
the sandbox and invalidates the reference; scripts must call `JS.New` again
to obtain a fresh context. Calls on another handle do not renew it. Ending a
session releases all its handles immediately; an engine-owned session ends
when its script run finishes. Explicit `JS.Release` frees capacity sooner.

MBS's `JSON.*` functions run too: Parse and the other reference functions, Format,
Compact, GetPathItem and SetPathItem (MBS's list paths and FileMaker-style
ones), the Add, Create, Delete and Replace functions, the Get functions,
Equals, FindValueInArray, Merge and Sort. Numbers keep every digit they were
written with. A JSON reference lasts for the person's session; MBS doesn't
document its numbering, so Tabularius uses large numbers that won't be mistaken
for values in the data. What a formula builds is kept to a million values and
512 levels. JSON.Format's
layout follows MBS's pages; where they show only a flattened example (an array
holding objects), Tabularius puts each item on its own line. Not yet: JSONPath <!-- known-difference: MBS plug-in functions ;; JSON.Format puts each item of an array of objects on its own line, since MBS's pages show only a flattened example ;; The layout of that output can differ from MBS ;; An MBS run of JSON.Format on an array of objects --> <!-- known-difference: MBS plug-in functions ;; JSONPath and JMESPath (Query, Replace, ReplaceEvaluate, Search), Colorize, the record and import functions and the conversions to CSV, HTML, XML and TOON are not available ;; The call gives ? and error 3 ;; Owner decision on whether to build them -->
and JMESPath (Query, Replace, ReplaceEvaluate, Search), Colorize, the record
and import functions, and the conversions to CSV, HTML, XML and TOON. MBS's `Math.*` functions run
too (sums, averages, minimum, maximum, standard deviation, moving averages,
bitwise operations on 64-bit integers, hex and binary conversion, unit
conversion, polylines, NormInv, Rate, FormatNumber, NumberToText, card-number
checks and the Random distributions), as do `Time.Format`, `Time.Parse`,
`Time.UnixTimeStamp`, `Time.UnixTimeStampToFileMaker`, `Time.TimeStampToUTC`
and `Time.TimeZoneOffset`. Times follow the server's time zone and its
daylight-saving rules; MBS doesn't document every edge, so results around a
clock change are inferred. `%Z` in Time.Format gives US zones by their <!-- known-difference: MBS plug-in functions ;; Results around a clock change are inferred (MBS does not document every edge), and %Z in Time.Format gives US zones by abbreviation but others by offset ;; Times near a daylight-saving change, and zone names outside the US, can differ from MBS ;; An MBS run of those cases -->
abbreviation ("PST") but others by offset ("GMT+1" where MBS would print "CET").
Not yet: `Math.Median`, `Math.TextToNumber`, <!-- known-difference: MBS plug-in functions ;; Math.Median, Math.TextToNumber, Math.InsidePolygon, Time.Sleep and Time.Wait are not available ;; The call gives ? and error 3 ;; Owner decision on whether to build them -->
`Math.InsidePolygon`, `Time.Sleep` and `Time.Wait`. MBS's `XML.*` functions run
too: GetPathValue, SetPathValue, SetPathXML, SetPathCData and DeletePath (MBS's
dotted paths), Format, Compact, Query (XPath 1.0), SubTree, ExtractText,
NodeNames, NodeCount, the attribute functions, Canonical, ApplyStylesheet and
ApplyStylesheet2 (XSLT 1.0), and Parse with the other reference functions.
MBS uses libxml2 and its pages don't show every byte, so Tabularius writes what
libxml2 writes (two spaces for each level, a line feed after the declaration,
no line break at the end); where several nodes come back from XML.Query, how
they are laid out is inferred. XML Tabularius can't read is an error even with <!-- known-difference: MBS plug-in functions ;; How several nodes returned by XML.Query are laid out is inferred; XML Tabularius cannot read is an error even with flag 1, a DOCTYPE is left out, and XML.SetSaveNoEmptyTags lasts for the session ;; Output can differ from MBS in those cases ;; An MBS run of those cases -->
flag 1, a DOCTYPE is left out of what comes back, and XML.SetSaveNoEmptyTags
lasts for the session rather than the
whole server. Not yet: Colorize, Validate, ToJSON, Tidy, ToHTML, exclusive <!-- known-difference: MBS plug-in functions ;; Colorize, Validate, ToJSON, Tidy, ToHTML, exclusive canonical form and the file, container, record and import functions are not available ;; The call gives ? and error 3 ;; Owner decision on whether to build them -->
canonical form, and the file, container, record and import functions. MBS's
`Dictionary.*` and `Variable.*` functions run too, keeping each value's type.
MBS lists keys in no set order; Tabularius lists them in descending order, as
every example on MBS's pages does. MBS's variables are shared by everyone on
a server; Tabularius keeps them for the person's session, so no one sees another
person's values. Dictionary.Serialize writes Tabularius's own form, which only
Tabularius's Deserialize reads. Not yet: Dictionary.ToXML and the SQL, variable-setting and custom-function ones. MBS's `List.*` functions <!-- known-difference: MBS plug-in functions ;; Dictionary.ToXML and the SQL, variable-setting and custom-function Dictionary functions are not available, and Dictionary.Serialize writes Tabularius's own form that only its Deserialize reads ;; The call gives ? and error 3; serialised text from MBS is not read ;; Owner decision, and an MBS serialised sample -->
run too (values by index, matching, columns, sets, duplicates, sorting, Find,
BestMatch and the rest). A list ends with a return where MBS's NoReturnEnding
parameter says so; values compare case-sensitively unless MBS's page says
otherwise; sorts go by character code (MBS doesn't name its order). Not yet: <!-- known-difference: MBS plug-in functions ;; List.CSVSplit, List.OrColumn, List.XOrColumn and List.SortWithEvaluate are not available, and sorts go by character code because MBS does not name its order ;; The call gives ? and error 3; sorted order can differ from MBS ;; Owner decision, and an MBS run that shows its sort order -->
List.CSVSplit, List.OrColumn, List.XOrColumn and List.SortWithEvaluate. MBS's
`QuickList.*` functions run as well, on lists kept for the session by
reference (numbered from 12000, as MBS does, or by the name given); the same
four are not yet available there, nor QuickList.AddSQL. The Hash functions <!-- known-difference: MBS plug-in functions ;; The same four List functions and QuickList.AddSQL are not available ;; The call gives ? and error 3 ;; Owner decision on whether to build them -->
(MD5, SHA1, SHA256 and SHA512 digests and HMACs, `Hash.Digest`, `Hash.CRC16`,
`Hash.CRC32`) work on text, hex, base64 or container data. A few path and
container helpers work too, along with `Version`, `IsRegistered` and progress
dialogs. The following results are inferred and unverified against the vendor:
<!-- known-difference: MBS plug-in functions ;; IsLinux, IsWindows and IsMac report the server process platform; IsServer reports whether a script runs without a person, including schedules, Perform Script on Server, Data API, MCP and CLI runs, and returns 0 in the web client ;; A script can take a different platform or server branch than with the vendor plug-in ;; A vendor run on each host and client type -->
`IsLinux`, `IsWindows` and `IsMac` answer 1 or 0 from the server's platform;
`IsServer` answers 1 for a script with no person and 0 in the web client.
<!-- known-difference: MBS plug-in functions ;; Trace silently answers OK and Path.AddPathComponent joins with one separator from the input path style; empty components and trailing separators follow the simplest join rule ;; Vendor logging or path output may differ, especially at path edges ;; A vendor run with logging and empty, trailing-separator and mixed-separator paths -->
`Trace` answers `OK` without writing a log. `Path.AddPathComponent` joins
with `/` when the path contains `/`, otherwise with `\`, adding one separator;
empty components and trailing separators use this simple rule.
<!-- known-difference: MBS plug-in functions ;; CURL.SetUpdateProgressDialog answers OK and ProgressDialog.GetCancel answers 0 because a server has no progress dialog ;; A script relying on dialog cancellation or vendor side effects may behave differently ;; A vendor run of these calls in server and client scripts -->
`CURL.SetUpdateProgressDialog` answers `OK`, and
`ProgressDialog.GetCancel` answers 0; there is no server dialog to cancel.
`Folders.UserDesktop` remains unavailable because it names a person's
computer folder. <!-- known-difference: MBS plug-in functions ;; Folders.UserDesktop is unavailable because it names a person's computer folder ;; The call gives an MBS error text and IsError then answers 1 ;; A safe client-folder capability and a vendor run showing its contract -->
Any other MBS function, including other file-path operations and `Hash.PBKDF2.HMAC`,
returns an error text saying it isn't available in Tabularius. As in MBS,
`MBS ( "IsError" )` tells whether the last MBS call gave an error (1) or not (0).
MBS says it keeps that state per script; here it is kept for one script run,
subscripts included, so a different run, or a calculation outside any script,
starts at 0.

Any other plug-in's functions give "?", as in FileMaker when the plug-in
isn't installed, so a script's "is the plug-in there?" checks still work.

### Install Plug-In File

A script's Install Plug-In File step is off until an administrator turns it on with `tabularius plugins <folder> script-install on`. Then it installs a signed `.ohplugin` package placed in the server's `Documents` folder, but only from a publisher the administrator already trusts, only for a script with full access, and without turning the plug-in on for any file. Anything else is refused (error 3, or 9 without full access) and written to the file's security log, as is each install.

### Adding plug-ins (early)

A plug-in written for Tabularius goes in its own folder under `plugins/` in
the server's data folder: a `plugin.json` naming its functions (and, to
answer a FileMaker plug-in's calls, that plug-in's 4-character id and each
function's index) and a `main.js` that defines
`const functions = { Name ( a, b ) { ... } }`. Enable it for a hosted file
with `tabularius plugins <folder> enable Invoices org.example.troi-file` (it
writes `plugins/enabled.json`), and see what's installed and where it's on with
`tabularius plugins <folder>`. `Get ( InstalledFMPlugins )` lists the server's
plug-ins, Enabled for the files that have them on. Its
code runs in the same sandbox as JavaScript custom functions (no network or
modules), loaded once and kept for later calls. A plug-in whose `plugin.json`
asks for `"permissions": { "files": ["documents:read", "documents:write"] }`
(or `temporary:read` / `temporary:write`) gets `tabularius.files.read`,
`readBase64`, `write` and `size` in the same folders scripts' file steps use;
a call that touches a file may run twice, so it should give the same answer
both times. One that asks for `"network": ["api.example.com", "*.example.net"]`
or `"mail": true` gets `tabularius.http.request ( { method, url, body } )` and
`tabularius.mail.send ( { from, to, cc, bcc, subject, body, attachments } )`.
`tabularius.http.request` returns `{ status, body, headers }` (or `error` when the
request failed) and takes an optional `headers` object. It makes real requests
only where the file's scripts may reach the network (its Script network switch), only to
the hosts the plug-in lists (a redirect to another host fails), with a 30 second
limit, and never from a capture-only file. With `serve --test-outbound`
requests and mail are recorded in the Outbox like BaseElements' calls and never
sent. The step runs again after a request is made, so a plug-in that writes a
file or keeps state before asking should do it after; the same request twice in
one step is made once.
`tabularius.mail.send` sends a real message only on a server started with `serve
--send-mail --mail-from ADDRESS` (the same switch and SMTP account as Send Mail via
SMTP), and only for a plug-in whose `plugin.json` asks for `"mail": true`. The
message goes through that account from that address, with the plug-in's `from`
name shown and its address as Reply-To; at most 100 recipients, at most 20
messages in one step, and never from a capture-only file or while one is in
the folder. It returns true, or the calculation gives `?` when the message
wasn't sent. Without `--send-mail`, nothing is sent.
One that asks for `"secrets": ["API_KEY"]` gets `tabularius.secrets.get ( "API_KEY" )`,
null until you set it with `echo "$KEY" | tabularius plugins <folder> secret
org.example.troi-file API_KEY` (or clear it with `--clear`). Secrets live in
`plugins/secrets/`, readable only by the server's user, are read when asked
for (no restart needed) and are never logged or listed; `tabularius plugins
<folder>` shows only which are set. The server reads the plug-ins folder when
it starts.

#### WebAssembly plug-ins

A plug-in written in Rust, C, Zig or anything else that compiles to WebAssembly
sets `"runtime": "wasm"` and `"main": "main.wasm"` in `plugin.json`. The module
runs in the same sandbox as JavaScript plug-ins, with no imports at all (a
module that imports anything is refused), at most `min(memoryMb, 64)` MB of linear memory (64 MB by default), and the same
time limit. It can compute, but cannot read files, reach the network or use
secrets. Those need the JavaScript runtime for now.

The module exports `memory`, `alloc(length) -> pointer`, and one function per
FileMaker function, named as in `plugin.json`: `name(pointer, length) -> i64`.
The arguments arrive at `pointer` as a JSON array (text and numbers, dates as
ISO text). The function returns the address and length of its answer, as JSON
(text, number, true or false, null, or an object), packed as
`address * 2^32 + length`.

#### Plug-in packages and signing

A plug-in can be shipped as one file, `<id>-<version>.ohplugin` (a zip of
`plugin.json`, the file it names as `main`, and optionally a README and
LICENSE). A publisher makes a signing key once with `tabularius plugins <folder>
keygen publisher.pem` (keep that file secret; it prints the publisher's
fingerprint) and packs a plug-in folder with `tabularius plugins <folder> pack
./my-plugin --key publisher.pem`. To install one, run `tabularius plugins <folder>
install thing.ohplugin`: it first prints what the plug-in asks for (files, web
hosts, mail, secrets). A signed package from a publisher you haven't trusted is
refused until you check the fingerprint with them and install again with
`--trust <fingerprint>`; after that their packages install without it. A
package with no signature needs `--allow-unsigned`, and a package signed by
someone else doesn't replace an installed plug-in without `--replace`. A
signature says who published a package, not that it is safe: the sandbox and the
permissions you see are what keep a server safe. The files are unpacked into
`plugins/<id>/` and a file changed afterwards is not loaded. `tabularius plugins
<folder> uninstall <id>` removes one that no file has on.

The admin console has a Plug-ins page (it appears once the server has one): it
shows who made each plug-in and what it asks for, turns it on or off for a
hosted file at once (no restart), and sets or clears the secrets it asked for.
A secret's value is never shown again after you save it.

The BaseElements functions are built in rather than installed: they are on for
every file, `Get ( InstalledFMPlugins )` lists BaseElements as Enabled, and the
console (or `tabularius plugins <folder> disable <database>
com.openhbam.baseelements`) can turn them off for a file whose solution doesn't
use them, so its `BE_` functions give `?` there as in FileMaker when a plug-in
isn't installed.

### Perform Script on Server works as on FileMaker Server

The script runs in a fresh session as the caller's account. It doesn't see
the caller's layout, found set, record, globals or variables, so pass what
it needs in the parameter.

### Things that don't work yet

- containers in secure (encrypted) external storage
- per-layout, per-value-list and per-script custom privileges, record
  access limited by a calculation, and the menu command options, from the
  file (see above)
- checking FileMaker's non-empty passwords (see above)

`tabularius report` lists what applies to your file.

### Things FileMaker doesn't have

- **Locks:** typing in a record locks it, as in FileMaker. Changes then show
  live in everyone's windows, without a refresh.
- **Audit log:** every record created, changed or deleted is logged with
  the account and time. `tabularius audit ~/Databases Invoices --table Invoices
  --record 42` shows it.
- **Script debugging on a scratch copy:** the script debugger runs on a
  throwaway copy by default, so stepping through a script that deletes
  records changes nothing.
- **Backups and restore to a moment:** backups run daily and each one is
  checked. `tabularius restore <folder> --at "..."` puts a file back as it was
  at a moment, to the minute with `serve --progressive`.
- **SQL:** `serve --sql-port 5432` lets BI tools and PostgreSQL ODBC/JDBC
  drivers query files, for accounts with `fmxdbc`. Results over 100,000 rows
  by default (`TABULARIUS_PGWIRE_MAX_ROWS` sets a different whole-number
  cap, 0 for no cap; invalid or negative values use the default)
  are refused with SQLSTATE `54000`; use SQL `LIMIT` and page with a stable
  `ORDER BY` (see [result limits](pgwire-results.md)).
- **No per-user licensing.**

## Checking what a conversion left out

`npm run converter-quality` reads the layouts of each `.fmp12` file it is given
(by default the sample files `npm run fixtures` downloads) and lists the objects
that did not come through whole: an object type the converter does not know, a
field or portal whose table occurrence or field could not be named, an object
with no width or height, text read with replacement characters (these are
errors), a Perform Script or Go to Layout button whose target is not in the file,
a picture missing from the image library, a layout of a table occurrence the file
no longer has (warnings), and buttons with no action or layouts with no objects
(for your information; both can be intended). `--strict` exits 1 when a file has
an error and `--json` prints the findings. It reads files only and writes
nothing. The sample files are part of the test run, which fails on a new error,
so a gap is seen there before it is seen on someone's file.

## Counting what a collection of files uses

`tabularius corpus-scan <folder>` is for someone looking at many `.fmp12` files at
once, such as the files of every client of a consultancy. It counts what the
files use: plug-in calls, functions, `Get ( )` options, script steps, layout
objects and triggers. `--convert` also tries converting each file and counts the
failures; identical files are scanned once. It writes `corpus-report.json` and
`corpus-report.md` and nothing else.

The report holds counts only. Files are named by a hash of their content, and a
formula leaves the scan only as a shape with every field, variable and custom
function name, string, comment and long number masked. No record data, names or
paths. Run `tabularius corpus-scan --help` for the options (`--jobs`, `--timeout`,
`--only`, `--dedupe-only`, `--all`). `--timeout SECONDS` limits each child scan
(default 300 seconds); `--only ANON-ID` rescans the one 12-character content
hash shown in a report. On timeout, the JSON and Markdown reports retain the
last stage reached, total bytes read (including repeated reads), tables and
records converted so far, sampled peak V8 heap, and a per-stage time table.
These are counts and timings; they contain no record values or file paths.

## Leaving: take your data with you

A hosted file is an ordinary SQLite file and your records are yours. For a
script any SQL database can load, `tabularius export-sql` writes the tables and
the records:

<!-- docs-example: placeholders {"<folder>": "~/Databases", "maria": "Admin", "--out Invoices.sql": "--out Invoices-$$.sql"} -->
```sh
tabularius export-sql <folder> Invoices --out Invoices.sql                    # PostgreSQL
tabularius export-sql <folder> Invoices --out Invoices.sql --dialect sqlite   # SQLite
tabularius export-sql <folder> Invoices --out Invoices.sql --account maria    # only what maria may export
```

The command prints counts (tables, fields, rows, keys, what was left out and
why) and never a name or a value, and it refuses to overwrite a script. The
script runs as one transaction: `psql -f Invoices.sql`, or `.read` in the
`sqlite3` shell.

What comes across:

- **Tables and fields** as tables and columns, with a `record_id` primary key
  (the record id). Text, number, date, time, timestamp and container fields map
  to `TEXT`, `DOUBLE PRECISION` (`REAL`), `DATE`, `TIME`, `TIMESTAMP` and `TEXT`
  in PostgreSQL; in SQLite the dates and times are ISO text. In a file made with
  native types, whole numbers, decimals, booleans, JSON and UUIDs keep theirs.
  A name that is too long for PostgreSQL, or differs from another only in case,
  is shortened or numbered.
- **Containers** are written to a folder beside the script (`Invoices.files/`),
  and the column holds the path relative to the script.
- **Repeating fields** are arrays in PostgreSQL (`TEXT[]`) and a JSON list in
  SQLite. Repeating containers are not carried.
- **Stored calculations** are plain columns holding the value last stored, with
  the formula in a comment. Unstored calculations, summary fields and global
  fields have no per-record value and are left out.
- **Unique and not-empty field options** become `UNIQUE` and `NOT NULL`, **a
  relationship made of one equality** becomes a foreign key to the side whose
  field is unique, and the matching fields are indexed. A constraint the data
  already breaks (a repeated value in a "unique" field, a value with no match)
  is left out, and counted, so the script still loads.
- **Serial numbers** become sequences in PostgreSQL that start past the largest
  value in use; in SQLite the next value is in a comment.
- **Value lists** of typed-in values become lookup tables (`value_list_<name>`,
  with a `position` column). Lists drawn from a field are not carried.
- A value that doesn't fit its column's type (the text `soon` in a date field, a
  time of 25 hours) is written as `NULL` and counted. Empty and `NULL` come out
  as the file stores them.

Not carried: scripts, layouts, themes, privilege sets and accounts, custom
functions, and the relationship graph beyond the keys above. With `--account`,
the account needs the export privilege, and it gets the records and fields it
can view, nothing else.
