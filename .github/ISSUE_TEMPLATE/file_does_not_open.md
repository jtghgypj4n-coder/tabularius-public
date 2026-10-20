---
name: A FileMaker file does not open
about: A .fmp12 file will not convert, host or open. Please do not attach the file.
title: ''
labels: bug
assignees: ''
---

**Please do not attach the file, a backup of it, or screenshots of its records.** It may hold real data. This form asks only for facts that do not.
Never paste a password, a token or a customer's details. How to describe a problem without sending the file: [docs/reporting-a-file-that-does-not-open.md](../../docs/reporting-a-file-that-does-not-open.md).

**The exact message you were shown, and where** (the welcome page, Hosted files, the server's log, the command line)

**The output of these two commands, run on your computer** (neither prints a record, a script or a password; change the file name line if it is private)

```
tabularius version
tabularius info YourFile.fmp12
```

**If a server is involved**, attach the bundle from `tabularius diagnostics <folder>` (a `.zip` of plain text; read it first, it is made not to carry records, passwords, tokens or file names)

**The file's size in bytes** on the computer it came from, and on the one you uploaded from (if they differ, the copy is incomplete: copy it again first)

**What made the file**, if you know (FileMaker Pro or Server and its version, an older file converted forward, a file from a developer's tool)

**How you run Tabularius** (Docker, installed, from source) and the operating system

**Anything else about the solution** in general words ("a contacts file with portals and some scripts"), not its name or its customers

*Security problems: do not file them here. Follow the private route in [SECURITY.md](../../SECURITY.md).*
