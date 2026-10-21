# tabularius demo

This command's usage comes from `tabularius help demo`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius demo [--starter crm|inventory|invoicing|tasks|booking] [--keep <folder>] [--port 8080] [--no-open]
                                             Try it: a starter app with sample records, hosted for this
                                             computer only on a free port, with an Admin account whose
                                             random password is printed once. Opens the browser if it can.
                                             Everything is deleted when you press Ctrl-C (--keep <folder>
                                             leaves the files there). Nothing goes off this computer
```

## Options

`--keep`, `--no-open`, `--port`, `--starter`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius demo --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
