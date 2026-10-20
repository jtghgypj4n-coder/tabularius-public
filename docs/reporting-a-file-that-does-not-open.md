# Reporting a file that does not convert or open

A FileMaker file can hold a company's real data, so you should never have to send one to get help, and nobody on the project will ask you to attach one to an issue. This page says what to send instead, and what to leave out.

## First, the usual causes

Most files that do not host are not a bug in Tabularius. [Troubleshooting](troubleshooting.md) lists the messages by their wording. The common ones: a copy that stopped early (the file is smaller than the original), a file saved by another program under a `.fmp12` name, a file with Encryption at Rest that needs its passphrase, and a very old format (FileMaker 6 and earlier).

## What to send

Run these on your own computer. None of them prints a record, a field value, a script's text or a password.

<!-- docs-example: illustrative -->
```sh
tabularius version
tabularius info Contacts.fmp12
```

`info` prints the file's name (change that line if the name is private), the format and the FileMaker version that wrote it, whether it is encrypted, and how many tables, fields, layouts, scripts and accounts it has. Add:

- the **exact message** you were shown, and where you saw it (the welcome page, Hosted files, the server's log, the command line);
- how you ran it (Docker, installed, from source) and the operating system;
- the size of the file in bytes on the original computer and on the one you uploaded from. If the two differ, the copy is incomplete: copy it again first.

If Tabularius hosts other files or runs as a server, add the bundle `tabularius diagnostics <folder>` writes. It is plain text you read before you send it, and it is made so that it cannot carry records, passwords, tokens, file names, addresses or your user name:

<!-- docs-example: illustrative -->
```sh
tabularius diagnostics /path/to/your/folder --out diagnostics.zip
```

Its `README.txt` lists what each file holds. Hosted files appear as `file-1`, `file-2` unless you add `--include-names`. The last lines of the server log are included with quoted text, names from your solution, addresses and secrets replaced, but read them before you send them: a value a message prints bare, with nothing around it, looks like any other word.

If you are willing, also say which FileMaker version made the file and what kind of solution it is ("a contacts file with a few portals", not its name or its customers).

## What never to send

- The `.fmp12` file, or a screenshot of its records.
- A password, an API token, or a backup.
- Table, field or script names if they identify your business. `tabularius info` does not print any, so use it rather than `tabularius schema`.

## If the report is not enough

We may ask what a smaller file shows. In FileMaker Pro, **File > Save a Copy as… > clone (no records)** makes a copy with the design and no data. Many conversion problems are in the design, so the clone shows them. A problem that only happens with certain data will not show in a clone: say so, and we will work out another way with you. We will never ask you to send a file you are not comfortable sharing, and if you choose to send one, nothing is promised about who can read it unless a private route has been agreed first.

## Where to report

Open an issue with the **A FileMaker file does not open** form. A problem that could let someone read data they should not is different: follow [SECURITY.md](../SECURITY.md) and use the private route.
