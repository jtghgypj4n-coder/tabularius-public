# tabularius reconvert

This command's usage comes from `tabularius help reconvert`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius reconvert <folder> <database>|--all [--dry-run] [--same-file] [--force]
                                             Convert a file (or every outdated one) again from its
                                             .fmp12 after a fix to the converter, keeping records
                                             created, changed and deleted since, accounts and
                                             settings (the store as it was is kept beside it).
                                             While the server runs, it is asked to do it (run as
                                             the user it runs as; no sudo, other files stay up).
                                             --dry-run shows what would change; --same-file: the
                                             .fmp12 is a copy of the one converted; --force
                                             converts afresh when edits can't be carried over
```

## Options

`--all`, `--dry-run`, `--force`, `--same-file`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius reconvert --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
