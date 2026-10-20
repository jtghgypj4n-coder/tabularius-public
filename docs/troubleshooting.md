# Troubleshooting

Look for the words you saw. Each heading below that is in code type is a message the program
shows, word for word (`{}` stands for a name or number that changes); the ones at the end, in
plain words, are things that go wrong without a message. A test makes each of these happen on a
small folder and follows the page's advice, so what is written here works (`packages/cli/test/troubleshooting-proven.test.ts`). For a first look
at everything at once, run `tabularius doctor <folder>`: it checks Node, the folder,
the disk, the port, the certificate, the backups, the pages of every hosted file and
the service, and prints one fix for each problem. It changes nothing.
[The runbook](runbook.md) is the other way in: it starts from what went wrong (a lost password, a lockout, a damaged file, a lost server) and gives the steps in order.
To report a problem you could not fix, run `tabularius diagnostics <folder>`: it writes a `.zip` of plain text (versions, the system, switches and numbers from the settings, each hosted file's size and how many tables, fields, layouts and scripts it has, what `doctor` says, and the last 500 lines of the Event and ScriptEvent logs) that you read first and then attach. It holds no records, passwords, tokens, file names (unless you add `--include-names`), addresses or your user name in a path. Text between quotes in the log, names from your solution, secrets, email addresses and addresses are replaced before anything is written; a value a message prints without quotes and without a pattern that gives it away (a plain first name, say) cannot be told from a word, so read the two `log-` files before you send them.

## `port {} is in use: another program is already listening on`

Another program holds the port, often an earlier `tabularius serve` still running.
`lsof -nP -iTCP:<port> -sTCP:LISTEN` (macOS, Linux) names it. Stop that
program, or start this one on a free port: `tabularius serve <folder> --port 8081`.
For a service, `tabularius service install` names a free port when yours is taken.

## `{} can't be read and written by this user`

The folder you gave `tabularius serve` belongs to someone else, or is read-only for the user the server runs as. In Docker the server runs as an unprivileged user with the number 1000, so the folder you mount must be writable by it: `sudo chown 1000:1000 Databases`, then look at `docker compose logs tabularius`: a container that stopped on this message is restarted by Compose (`restart: unless-stopped`), so it comes up by itself once the folder is right. If Docker created `Databases` for you because it did not exist, it belongs to root: the same `chown` fixes it. Outside Docker, give your user the folder with `chown` or `chmod`, or serve a folder you own. `tabularius doctor <folder>` names this too.

## `Invalid user account and/or password; please try again`

Data API error 212. The account name or password is wrong, or the account is
turned off. Check the account in
the admin console, or set a new password:
`tabularius passwd <folder> <database> <account>`. A web client sign-in failing the
same way has the same causes. If the admin password itself is lost, set a new one
from the machine that hosts the files: `tabularius admin-password <folder>`.

A file name that is not hosted gets this same answer, on purpose: a stranger can't use the sign-in
to find out which names exist. So when a password you are sure of is refused, check the file name
too (`tabularius doctor <folder>` lists what the folder holds, and says if one is damaged or still
converting).

## `Too many failed sign-ins; try again after {}`

Five wrong passwords for one account within 15 minutes lock that account for 15 minutes, so a stranger
can't guess forever; the time is when it ends (`Retry-After` says how many seconds). This is error 212 at
the Data API and the web client, and the right password waits too. Wait, or lift it now: in the admin console
open **Security health**, find **Account access**, type the account and press **Unlock (lift sign-in
lockout)**. Setting the account a new password does the same. A person who keeps being locked out
is usually typing an old password, or another program on a phone or in a script is trying one.

## `Too many failed attempts. Try again in {} seconds.`

This is the admin console's own sign-in: five wrong console passwords from one address lock that address for 15
minutes. The console can't lift it for you, since you can't sign in. Wait the seconds shown, or restart the server
(the lock is kept in the server's memory, so a restart clears it); then type the right password. If you
no longer know it, set a new one from the machine that hosts the files: `tabularius admin-password <folder>`.

## `AI is turned off for {}`

That file has AI turned off, so no AI app (the MCP connector, the assistant) can
read it, whatever the account's privileges. It is turned off in the admin console,
with `tabularius ai <folder> <database> off`, or by the server's `--ai-exclude`; turn it back on the
same way (`tabularius ai <folder> <database> on`). A file that uses data from another file stays off
while the other file's AI is off; the message names which one to turn on.

## `Unable to open file`

Error 802, from the routes that name a file after you are in (the AI connector, the assistant, calendar feeds):
the name doesn't match a hosted file, or the file failed to open. Hosted names are the file names without
`.fmp12`; the AI connector's answer lists them. The Data API doesn't say 802 at sign-in: an unknown name reads
as a wrong password (error 212, above), and a token made before the file went away reads as error 952. Either
way `tabularius doctor <folder>` lists what is in the folder, and the server's log says why a file that is
there didn't open.

## `{} is damaged ({}) and is not being served`

A hosted file's pages are damaged: a failing disk, a copy cut short, a sync tool or a
restore that was interrupted. The server finds it three ways: when the file is opened,
by a check of every file's pages a moment after the server starts, and the first time a
query lands on a bad page. The file is then taken offline; a sign-in to it now reads like a wrong password
(error 212, as for any name that isn't hosted). Nothing
more is written to it, and every other hosted file keeps working. The server log says
`{} is damaged (...) and is no longer served`, and the admin console lists the file as
closed with the reason.

`tabularius doctor <folder>` names the damaged files (add `--full` for the slower check that
also compares every index with its table). To put it right, stop the server, restore the
file from the newest backup that passes `tabularius verify-backup <folder>`, and start again:

    tabularius restore <folder> <backup-set> <database>

The restore keeps the sign-in state of the file it replaces, so a password or token you revoked since the backup stays
revoked. When the damaged file is too damaged to read that state, there is none to keep: the restored accounts have no
password until you set one (`tabularius passwd <folder> <database> <account>`), and API tokens, two-factor secrets and passkeys
from before are gone.

Two accounts whose names a directory reads as one (`Straße` and `Strasse`, an accent
written two ways) count failed sign-ins together, so guesses against one lock the other.
The admin console refuses to make such a pair, but a file made before that can hold one.
The server log names the pair when it opens the file, and `tabularius doctor <folder>`
lists it; rename or delete one of the two.

A file that was put back (restored, or a good copy dropped in) is served again from the
admin console's Start, or on the next start, once it passes the check. A restore refuses a
backup whose file fails the same check, and replaces nothing.

What none of this can see: SQLite does not checksum its pages, so a byte changed inside a
record, with every page still readable, passes. Backups carry a checksum for every file
(`verify-backup` compares them), which is why keeping them matters. A write-ahead log that
was deleted or cut short loses the commits after the last whole one and gives a file that
is sound but older; nothing records that it happened.

## `{} is an empty file (0 bytes), not a database`

The file is 0 bytes: a copy or a restore was cut short, or the disk ran out while it was
made. It is left as it is (nothing is built into it). Restore it from a backup as above; as there, the restored accounts then have
no password until you set one with `tabularius passwd`.

## `{} was written by a newer Tabularius (file format {}; this version reads up to format {}), so it is not opened`

A newer version of Tabularius has opened this file and changed how it is stored, and the version running now would not
know what it added. The file is left exactly as it was, and the server serves the others. Either run the newer version
again (`tabularius upgrade`), or put back a backup made before the newer version first opened it:
`tabularius restore <folder> <backup-set>`; whatever was written since that backup is not in it.
`tabularius doctor <folder>` names every such file, encrypted ones too when `TABULARIUS_ENCRYPTION_KEY` is set (without it, it says which stores it could not look into). [Upgrading](upgrading.md) says what is promised across versions.

## `{} could not be written: the disk is full`

The disk holding the data folder has no room, or reported a write error. The write that
met it was not saved; the file itself is sound, and stays in use. Free some space (the
write-ahead log and a backup run need room: `tabularius doctor` budgets for both) and try
again.

## `Record is in use by another user`

Error 301. Someone else is editing that record. It is released when they commit
or leave it; a script can wait and try again. The message names the account.

## `Invalid FileMaker Data API token (*)`

Error 952, HTTP 401. The sign-in token a program holds is no longer one the server knows. Tokens from
`POST /sessions` live in the server's memory and end after 15 minutes without a call, when someone signs out, and
whenever the server restarts or is upgraded, so a script that signed in once and kept the token fails the first call after a
restart. Sign in again with `POST /sessions` and use the new token; a script that runs for a long time should do that
whenever it gets 952. The web client does it for a person: it says `Your session ended. Please log in again.` and
shows the sign-in page. For something that must outlast restarts, make an API token with
`tabularius token <folder> <database> create <account>`; it is kept in the file, shown once, and used as a Bearer token.

## `couldn't sign in to {}`

From `migrate-fms` or a sync: the account and password given for the other
FileMaker Server were refused. Check them there (the account needs the
`fmrest` extended privilege), and that the address is right and reachable from
this machine.

## `not a FileMaker file (bad magic number)`

The file given to `tabularius` (or uploaded in the admin console) doesn't start the
way a `.fmp12` file does, so it was refused before any of it was read. Usual
causes: a download or copy that stopped early or saved an error page under the
`.fmp12` name, or a file with another format renamed to `.fmp12`. Copy the file again from its source and
compare its size with the original.

## `unsupported FileMaker format "{}" (fp5 and older are not handled)`

The file is a FileMaker file, but of a generation Tabularius doesn't read. Only
`.fmp12` files are handled. Open the file in a FileMaker version that can convert
it to `.fmp12`, then use the converted copy.

## `can't decrypt {}: wrong passphrase, or the file is damaged`

An encrypted backup was opened with the wrong passphrase, or part of the backup is
damaged. Encrypted backups use the passphrase set in `TABULARIUS_BACKUP_KEY` when
they were made; restoring needs that same passphrase, and there is no way back
without it. Try the passphrase again, and if it is right, restore from an earlier
backup set. A FileMaker file with Encryption at Rest says `wrong passphrase` when
its own passphrase is wrong: enter it again in the admin console (or in the terminal
prompt, or `TABULARIUS_SOURCE_PASSPHRASE`, for the command line).

## `Can't reach the server. Check the connection and try again.`

The web client or the admin console sent a request and got no answer at all: the browser's own
"Failed to fetch" (Firefox says "NetworkError", Safari "Load failed"). Either the server is not
running, the computer or network between the two dropped, or the address changed. Open the same
address in a new tab. If that does not load either, start the server again (`tabularius serve <folder>`,
or restart the service) and reload the page.

## `The server did not answer (HTTP {})`

HTTP 502 or 503: something between the browser and Tabularius, such as a proxy or a tunnel, got no
answer from Tabularius. If Tabularius sits behind a proxy, check that the proxy points at the address
and port the server listens on, and that the server is running. HTTP 504 says the server took too
long to answer (`The server took too long to answer (HTTP 504)`): try again, and ask for less at a
time if it keeps happening.

## `The server could not do that (HTTP {})`

Tabularius answered with a failure of its own (HTTP 500 and the like) that carries no message the page
can show. The reason is in the server's log: the terminal that started it, or the service's log. Try again; if it keeps happening, send the log line to
whoever runs the server.

## `Request body too large`

Data API error 960 (HTTP 413). The request carried more data than that endpoint
takes: a Data API request is limited to 10 MiB of JSON, and a file import in the web
client to 50 MiB less 64 KiB. Send less in each request: for the Data API, fewer records per
call (page through them); for an import, split the file into parts and import each
one. Containers are sent separately, with the container upload call, not inside a
record (one container file may be up to 1 GiB).

If what you got is an HTML page, or `413 Request Entity Too Large`, it came from a proxy in front of Tabularius, which
has a limit of its own: nginx refuses anything over 1 MB until `client_max_body_size` is raised. Tabularius's own
answer is always the JSON one above.

## `Exceeded host's capacity: this request`

Error 812. One request used more of the server than it
may: it either ran too long without letting other requests in, or needed more memory
than the server has. The message says which. Ask for less at a time (a smaller found
set, a simpler layout, fewer fields, a smaller `limit`). A request that ran too long
is stopped after a minute by default; `TABULARIUS_REQUEST_BUDGET_MS` changes that limit
(0 for none).

## `couldn't convert {}`

The server saw a `.fmp12` in the folder (or an upload) and couldn't turn it into its
own store. The server's log has this line with the reason, and the admin console
lists the file as failed with the same text; it is the reader's own message, not
something to fix in Tabularius. The usual reasons are the messages above (a damaged
or partial copy, an old format, a wrong passphrase). Copy the file again and put it in
the folder; the server tries a file again when its size changes.

## `is empty (0 bytes). If it shouldn't be, copy it again`

The file you dropped on the admin console's welcome page (or chose under Hosted files) has no content. The usual cause is a copy that
had not finished, or a download that failed. Copy it again, check that its size matches the original, and drop it again.

## `ends too early, so it was probably copied only in part`

The file starts like a FileMaker database but stops before its own length says it should (the log has the reader's wording, such as
`block 1 out of range` or `block count 81 does not match file size`). Copy the file again from its source, compare its size
with the original, and drop it again. A file being written by FileMaker Pro or FileMaker Server at that moment is also copied in
part: close it there, or use a backup copy.

## `isn't a FileMaker database: it doesn't start the way a .fmp12 file does`

The file's name ends in `.fmp12` but its content is something else (a backup, an export, a text file or another program's file renamed).
Make sure it is the database file itself. A name that does not end in `.fmp12` is refused before anything is sent, with
`isn't a FileMaker database file. Choose a file whose name ends in .fmp12.`

## `is already hosted or being uploaded`

A file of that name (ignoring capitals) is hosted, or waits in the hosted folder, or an upload of it is in progress. If the page you
dropped it on says an upload "was started and never finished", that is usually a page closed in the middle of sending it: the button on
the page removes it and starts again. Otherwise open the hosted one from the link in the message, remove it first under Hosted files to
host this copy instead, or rename the file.

## `this server takes in one upload`

The file is bigger than `TABULARIUS_MAX_UPLOAD` (10 GB by default; the message gives the exact limit and both sizes). Copy it into the hosted
folder named in the message instead (the server converts files that appear there), or start the server with `TABULARIUS_MAX_UPLOAD` set to a
larger number of bytes.

## `Timed out after {} ms waiting to write {}: another tabularius process is writing it`

Tabularius keeps settings, schedules, tokens and similar state in small JSON files in the
data folder. Next to each one is a `<file>.lock.db`: an empty SQLite file that
Tabularius processes on this machine (the server and the command line)
lock while they change that state, so no change is lost. It is never written, and a
lock held by a process that exits or is killed is dropped by the system, so it never
needs cleaning up. Another Tabularius process held the lock for the whole wait: it is
still writing, or stuck. Try again; if it keeps happening, find the other
`tabularius` process and stop it. The lock only works on a local disk, like the
stores: keep the data folder off network shares and synced folders.

## `{} is read-only, so it can't lock {}`

The lock file next to a state file can't be written by the user Tabularius runs as
(often because it was copied in read-only, or made by a run with `sudo`). A
read-only lock file excludes nobody, so Tabularius refuses to write. Give it to that
user (`chown`, or `chmod u+w`), or delete it while Tabularius is stopped: it is made
again on the next write.

## `{} is damaged, so it can't lock {}`

The lock file isn't a SQLite file any more. Tabularius doesn't replace it itself,
because a process that still has it open would then lock a different file. Stop
every Tabularius process, delete the `.lock.db` file named, and start again; the
state file itself is untouched.

## `couldn't open the lock file {} for {}`

The lock file couldn't be made or opened: the data folder isn't writable by the
user Tabularius runs as, or the `.lock.db` name is taken by something that isn't a
file (a folder, say). Make the folder writable by that user, or remove what is in
the way while Tabularius is stopped. A missing folder says
`couldn't lock {}: the folder {} does not exist` instead: check the folder given
to Tabularius.

## When there is no message

These go wrong without Tabularius saying anything, so there is no line to search for.

## A file I put in the folder does not appear

The server looks at the top of the folder it was started with, every few seconds, for names that end in `.fmp12`
(capitals don't matter). It does not look inside a subfolder, and it skips a name that starts with a dot, or ends in
anything else (`Shop.fmp12.zip`, `Shop.fmp12.tmp`, `Shop.fmp12 copy`). A file that appears while the server runs is left alone until its
size has stopped changing, so a big copy shows up some seconds after it ends (one already in the folder when the server starts is converted
at once); files are converted one at a time, so a second waits for the first. A file whose name is already hosted is not converted again.

If it is there, named right, and still missing, open the admin console's **Hosted files**: a file that could not be read is listed there as
failed, with the reason, and the server's log has the same line (`couldn't convert Shop.fmp12: ...`; the entries above
say what each reason means). A file that uses Encryption at Rest waits there for its passphrase. And check that the server is
serving the folder you are looking at: `tabularius doctor <folder>` counts the files it would host.

The sign-in page lists the hosted files only when the server was started with `--list-files-publicly`; otherwise
a person types the file's name, and a name that is not hosted looks like a wrong password.

## The first open of a big file is slow

A `.fmp12` file is converted once, into the server's own store (`<name>.openhbam.sqlite`, beside it), and the converted store is what is
hosted from then on. A large file takes minutes the first time, and **Hosted files** in the admin console shows how far it has
got (tables and records). While it converts, signing in to it reads like a wrong password (error 212, above), because the server doesn't yet
host it; try again when the console says it is done. The next start opens the converted store, which takes seconds. After a file opens, and
again once changes settle, the server works out layout summaries in the background; until that finishes, a layout that totals a whole table
can show the result from before the latest change. Disk speed counts for most of it: keep the folder on a local disk, and
`tabularius doctor <folder>` checks the free space.

## The AI assistant or an AI app does nothing

Look at these in order.

1. The assistant in the web client is off unless the server was started with `--ai` and has an Anthropic API key (`ANTHROPIC_API_KEY`, or the
   key file the start-up help names). Without it the client doesn't offer the assistant and a call to it answers
   `The AI assistant is off on this server (start it with --ai and an API key)`.
2. The file must have AI on: `tabularius ai <folder> <database> status` says, and the entry `AI is turned off for {}` above turns it on.
3. The account must be allowed: its privilege set needs the **fmmcp** extended privilege (AI access), or the answer is
   `Insufficient privileges: the "{}" privilege set needs the fmmcp extended privilege (AI access)`. Tick it under Manage Security.
4. claude.ai and Claude Desktop's connector reach the server from the internet, so a server only on your network, or using `--https local`, can't
   be added that way; make a token in the admin console's **Connect an AI app** and use it with Claude Code or Claude Desktop's configuration
   instead ([Connect an AI app](connect-ai.md)).

## The browser says the connection is not private

A certificate warning means the browser can't check the server's certificate. Plain `http://` addresses give no warning, but passwords cross
the network unprotected (the server says so when it starts); the fix is a certificate, one of these:

- On a local network, start with `--https local`. The server makes its own small authority in the folder and a certificate for the
  machine's names and private addresses. Each computer, phone or tablet trusts the authority once: open
  `https://<server>:<port>/tabularius/tls/` (click through the warning this one time; the page needs no sign-in), follow the steps for that device, and
  compare the fingerprint it shows with the one the server printed at start. If the machine's addresses or name changed, restart the server so
  it makes the certificate again.
- On the internet, `--https files.example.com`: the name must point at the machine and port 80 must reach it; the server gets and renews
  a Let's Encrypt certificate itself.
- Your own certificate, `--tls-cert` and `--tls-key`: the warning appears when the address typed is not a name in the certificate (an IP address
  where the certificate is for a name), when the certificate has expired (`tabularius doctor <folder>` says), or when the file lacks the intermediate
  certificates after the server's.

See [Certificates](../ADMIN.md#certificates-tls).

## A page behind a proxy stays blank or says it did not start

The web client's files are found relative to `/app/`, and it calls the server at the root of the same address (`/fmi/`, `/openhbam/`,
and for the admin console `/admin/`). A proxy must therefore hand over the whole address, not a folder of it: a proxy that serves
Tabularius at `https://example.com/tools/tabularius/` breaks the calls (give it a name of its own, `files.example.com`), and one that
drops the slash in `/app/` breaks the page's files. When the page's script can't load, it says `This page did not start.` with a link to reload, instead
of staying blank. Then check, in the proxy:

- it forwards every path of that address, with the `Host` header and the original address of the visitor;
- it passes the types through (the page is `text/html`, its script `text/javascript`) and does not rewrite the page or add a policy of its own that blocks scripts;
- the server is started with `--public-url https://files.example.com` and `--proxy-header x-forwarded-for` (and `--trusted-proxies` when the
  proxy is on another machine), as [the admin guide](../ADMIN.md#certificates-tls) says.

## The browser blocks storage

Some browsers refuse a page any storage: the private windows of some browsers, "block all cookies and site data", some managed browsers. The web client
still signs in and works. It cannot remember the last file and account you typed, column widths and view preferences, and a reload of the page signs you
out, since the sign-in is kept only in the tab's storage. Turn on site data for the server's address if you want those. A test runs the web client
with every storage call refused (`packages/web/e2e/storage-blocked.e2e.ts`).
