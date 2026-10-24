# tabularius exit-bundle

This command's usage comes from `tabularius help exit-bundle`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius exit-bundle <folder> <database> --out <folder> --account A [--discard]
                                             Take a portable copy of the whole file: every table
                                             (SQLite and CSV), every container file, globals,
                                             serial counters, the design and the accounts without
                                             their secrets, with a manifest of SHA-256 hashes.
                                             A Full Access account; the password is asked for
                                             (or TABULARIUS_PASSWORD). PLAINTEXT, even when files
                                             are encrypted at rest. A stopped copy resumes when run
                                             again; --discard removes an unfinished one
```

## Options

`--account`, `--discard`, `--out`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius exit-bundle --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
