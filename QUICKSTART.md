# Quick start

Host a FileMaker file and open it in your browser in a few minutes. You
don't need FileMaker Pro or FileMaker Server.

## 1. Get Tabularius

On macOS or Linux, one command installs the single-file program. It needs no Node and
nothing else, and takes a minute or two:

<!-- docs-example: illustrative -->
```sh
curl -fsSL https://github.com/sitotisai/tabularius/releases/latest/download/get.sh | sh
```

It picks the build for your system (macOS or Linux, arm64 or x64), checks it against the
release's `SHA256SUMS`, and puts `tabularius` in `~/.local/bin` (it tells you if that isn't on
your PATH). `--version 0.1.0` installs a specific release instead of the latest. The script is
[`scripts/get.sh`](scripts/get.sh); read it first if you like.

**Want to look around first?** Run `tabularius demo`. It hosts a small sample app (companies,
contacts and deals) for this computer only, opens it in your browser, prints a one-time
password for the `Admin` account, and deletes everything when you press Ctrl-C. Nothing goes
off your computer. `--starter tasks` (also `inventory`, `invoicing`, `booking`) picks another
app, and `--keep <folder>` keeps the files.

Other ways to get it:

- **Download it yourself** from the [Releases page](https://github.com/sitotisai/tabularius/releases):
  the file named `tabularius-<version>-<system>-<processor>` (`macos` or `linux`, `arm64` or `x64`),
  and check it with `sha256sum -c SHA256SUMS --ignore-missing` (`shasum -a 256 -c` on macOS).
  Make it runnable with `chmod +x`. A file saved by a browser is quarantined by macOS, which won't
  run it until you clear that: `xattr -d com.apple.quarantine <file>`. (`get.sh` uses curl, which
  doesn't set the quarantine.)
- **Windows.** The release lists a `windows-x64.exe` program when it was built and passed its
  check for that release; Windows is the least tested system ([versions](docs/versioning.md)). Without
  one, use `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` from a checkout, which
  needs Git and puts a `tabularius` command on your PATH.
- **Linux with musl (Alpine)** can't run the program, which needs glibc. Use Docker
  (`docker compose up -d`) or the checkout install below.
- **From a checkout**, with Node 22.20 or newer: `./scripts/install.sh` on macOS or Linux. It
  puts a `tabularius` command on your PATH, and is the way to run Tabularius as a service
  with `--service` (see [ADMIN.md](ADMIN.md#install)).

## 2. Start it

```sh
tabularius
```

It hosts the folder `tabularius` in your home folder (made if needed), for
this computer only, and opens the admin console in your browser. Set
`TABULARIUS_FOLDER` to host another folder.

Keep the data folder on a local disk, outside Dropbox, OneDrive, iCloud
Drive and Google Drive, and off network shares. SQLite's write-ahead log
is unsafe on shared or synced storage. Copy completed backups there
instead. Leave room for the hosted files, retained backups, a growing log
and another backup run; `tabularius doctor <folder>` checks the location and
recommends free space based on your data (at least 1 GB).

## 3. Drop in a FileMaker file

Drop a `.fmp12` file on the page (or click to choose one). Tabularius converts
it once, hosts it, and opens it in the web client. Your `.fmp12` is left as
it is. A large file takes a while to convert, and the page shows how far it
has got.

Sign in with an account from the file, as you would in FileMaker. Accounts
with no password work from this computer only. Give one a password with
`tabularius passwd ~/tabularius <file> <account>`.

You can also copy `.fmp12` files into the folder while Tabularius runs. Each
file appears within a few seconds.

## 3b. No FileMaker file? Start from nothing

`tabularius new` makes an empty database, and `tabularius design-apply` fills it from a folder of
plain text files (tables, relationships, value lists, custom functions and scripts).
[`examples/first-app`](examples/first-app) is a small contacts book to start from:

<!-- docs-example: run -->
```sh
tabularius new ~/tabularius Contacts
tabularius design-apply ~/tabularius Contacts examples/first-app            # lists the changes, makes none
tabularius design-apply ~/tabularius Contacts examples/first-app --apply
tabularius passwd ~/tabularius Contacts Admin
```

For a bigger one with related tables, totals and scripts, use [`examples/invoices`](examples/invoices) the same way, and [`examples/support-desk`](examples/support-desk) to try an AI app working in a file. [`examples/crm`](examples/crm) has companies, contacts and deals with a find-based report.

Or start from a ready-made app: `tabularius new ~/tabularius Shop --starter invoicing` (also `crm`, `inventory`, `tasks`, `booking`; see [starter solutions](docs/starter-solutions.md)).

Open the file in the web client and sign in as `Admin`. Each new table comes with its own layout.
Change a text file and run `design-apply` again to see just what changed; design mode in the web
client and an AI tool over MCP make the same changes (see [docs/design-mode.md](docs/design-mode.md)).

## 4. Share it

- **With people on your network:** run `tabularius serve ~/tabularius --host 0.0.0.0 --https local`.
  They open `https://<this computer>:8080/app/` (each device trusts the server's certificate once from `/tabularius/tls/`). Set an admin password first
  with `tabularius admin-password ~/tabularius`.
- **All the time, as a service:** run `tabularius service install ~/tabularius`.
  It starts at sign-in, or at boot with `--system`. `tabularius upgrade`
  updates it in place later.
- **Over the internet:** add `--https files.example.com` (see the README's
  "Hosting for a team").

## What else is there

- **Integrations.** The FileMaker Data API at `/fmi/data/vLatest`, OData at
  `/fmi/odata/v4`, and SQL for BI tools.
- **AI tools.** An MCP server at `/mcp` for AI tools. The admin console's AI apps (MCP)
  section makes a token for an account and gives the settings for Claude Desktop or Claude Code.
- **Backups.** A backup every day in `<folder>/Backups`, each checked after it
  is taken. You can restore a file to a moment from the admin console.
  [Back up a file and restore it](docs/tutorials/backup-and-restore.md) walks through taking a copy,
  checking it and recovering a lost store.
- **What won't work yet.** Run `tabularius report ~/tabularius` to see what in your
  file doesn't work yet. The admin console shows the same after each upload.

Coming from FileMaker? [Move a FileMaker file in](docs/tutorials/move-a-file-in.md)
takes one file from "just a file" to hosted and checked in a few commands (a test runs
them, so it stays true), and [Moving a solution to Tabularius](docs/moving-a-solution.md)
walks through hosting, accounts, the AI tools and what differs.
The [README](README.md) covers everything else.
