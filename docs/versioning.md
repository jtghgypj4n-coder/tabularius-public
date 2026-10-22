# Versions: what a number means, what stays put, what is tested

Tabularius is at version 0.1.0 and nothing has been released or tagged yet. This page says how versions will be numbered, which things a new version leaves alone, which it may change, what is tested where, and how release notes are made. A test (`packages/server/test/version.test.ts`) holds the numbers below to the program.

## Where the version is shown

`tabularius --version` (or `-v`, or `tabularius version`) prints three lines:

```
tabularius 0.1.0
commit a1b2c3d
Node 22.20 or newer is needed; this is Node 22.20.0
```

The same version is in the web client's Help > About, at the top of the admin console, in the Data API's `productInfo`, in the admin status (`GET /tabularius/admin/v1/status`, with the commit), in the metrics (`tabularius_build_info`), in the MCP handshake and in `tabularius info`. They all read it from `packages/server/package.json`; the oldest Node comes from `engines.node` in the top `package.json`. The commit is the checkout's HEAD, or, in a release program, the commit it was built from. It says `unknown` for a copy of the files taken out of git.

To change the version, run `npm version 0.2.0 --workspaces --include-workspace-root --no-git-tag-version` in the repository. It sets the same number in the top package file, the eight package files under `packages/` and the lock file, and tags nothing. The test fails if the files disagree or any source file writes the number out.

## What 0.x means

- The number is `0.MINOR.PATCH`. While the major number is 0, a minor version (0.2.0) may change anything in the list "What may change" below. A patch version (0.2.1) fixes bugs and changes nothing in the list "What stays put".
- 0.x does not mean unfinished or untested. It means the promises below are the only promises. Where the program differs from FileMaker, or has not been checked against it, [known differences](known-differences.md) says so.
- Moving to 1.0 is the owner's decision, not made yet; see "Not decided yet".

## What stays put

A thing in this list is not removed or renamed without the release notes of an earlier release saying it will be, and where it is possible the old form keeps working for at least one minor version.

- **Command-line commands and options** in `tabularius help`, and their exit status (0 worked, 1 did not). What they print for a person to read is not in this list.
- **The routes FileMaker has**: the Data API under `/fmi/data/`, OData under `/fmi/odata/`, the XML grammars under `/fmi/xml/` and the Admin API under `/fmi/admin/api/v2/`. They follow Claris's documented behaviour; where Tabularius's answer was worked out without Claris's to compare, [Data API compatibility](data-api-compatibility.md) and the known-differences list say which. Claris's own changes to those APIs are followed, not promised in advance.
- **The routes Tabularius adds**, under `/tabularius/`, and the MCP tools, all as written in the [REST reference](reference/rest.md) and the [MCP reference](reference/mcp.md): their paths, parameters and the names of the keys they answer with. New keys may appear in an answer; a program reading an answer should ignore keys it does not know.
- **Error codes** of the Data API and script steps (the numbers, not the words).
- **Hosted files.** A newer version opens the `.openhbam.sqlite` files an older one made, brings them up to date, and `tabularius upgrade` backs the hosted folder up first. A kit of small files made by older builds is kept as test input (`store-forward-compat`). Every file records its file format number. A version that finds a newer number than it knows leaves that file closed, says why, and writes nothing to it. Going the other way, one built before the number existed cannot refuse, so opening a file with an older version than made it is not promised. [Upgrading and going back](upgrading.md) has the details.
- **The settings file** `.openhbam-settings.json` and the environment variables in [environment variables](environment-variables.md): a name keeps its meaning.
- **The data folder's layout**: hosted files beside their `Backups`, `Documents` and `Logs` folders.

## What may change in a minor version

- Anything not written down in the references above or in `tabularius help`.
- The words the program says to a person: messages, log lines, the admin console and web client's wording and layout, and what a command prints for a person to read. (A script should read an error code or JSON, not a sentence.)
- The AI assistant's prompts and behaviour, and the default model (`--ai-model`).
- The TypeScript under `packages/`, which is not offered as a library.
- Which FileMaker features are supported: a feature that was missing may be added, and one that was worked out without FileMaker to compare may change when it is checked against it. Such a change is in the release notes.

## Supported Node and platforms

Node 22.20 or newer (the number `tabularius --version` shows; the launcher refuses an older Node, and CI uses the same line).

What is tested, from the workflows in `.github/workflows/`:

| Platform | What runs on it |
| --- | --- |
| Linux | The whole unit and integration suite, the service install check, and the release build for x64 and arm64 |
| macOS | The whole unit and integration suite, the service install check, and the release build |
| Windows | The service install check and the release build only |

Anything else is untested: other Linux or BSD systems, Windows for the suite or the browsers, and Node versions other than 22 (the workflows install Node 22). The [install guide](../ADMIN.md#install) says what each install path does.

## Security fixes

Report a vulnerability as [SECURITY.md](../SECURITY.md) says. A fix is made in the next release, and its release notes list it under "Security and accounts". There is no separate advisory list or mailing list yet; see "Not decided yet".

## Release notes

`npm run release-notes -- --version 0.2.0 --since v0.1.0` prints the notes for the pull requests merged since a tag or commit. It publishes nothing and tags nothing. `--out FILE` writes a file, `--changelog` puts the `CHANGELOG.md` heading above the notes, and `--max-per-area N` sets how many of each area's newest changes are listed (12 by default; the rest are counted). `--prs FILE` reads a list of `{number, title, body, labels, files}` instead of the git history, for the descriptions and labels the history does not carry.

How a pull request gets its place and its words:

1. **Area.** A label `area:<name>` decides it. Without one, a title that starts `Docs: ...`, `[SQL] ...` or another area word decides it. Without that, the area that holds most of the files the pull request changed. The areas are: Conversion; Data API, OData and SQL; Web client; Design mode; Calculations and scripts; Security and accounts; AI and MCP; Admin console and server; Plug-ins; Command line and install; Documentation; Build and tests; Other.
2. **Words.** A line `Release note: ...` in the description is used as written; `Release note: none` leaves the pull request out. Without one, the title is used, without a trailing backlog tag such as `(r17e-13)`.
3. **Conversion work is counted, not listed.** Pull requests about reading and converting FileMaker files appear only as a count, because what they say can name private sample files.
4. **No names of people.** Authors are never printed, and an `@mention` or email address in a title is removed.

The first draft of `CHANGELOG.md` is made this way and kept for the owner to approve; nothing publishes it.

## Not decided yet

These are for the owner. Until they are decided, this page says only what is true today.

- **The label of the first public version**: 0.1.0 as it is, another 0.x, or 1.0.
- **How a security fix is announced**: only in the release notes, or also an advisory on the repository, or a mailing list.
- **How long a deprecated command, option or route keeps working**: this page says "at least one minor version" where it is possible.
- **Whether an older version should open a file a newer one made**, or refuse it with a message.
