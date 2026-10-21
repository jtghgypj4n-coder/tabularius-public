# tabularius sync-log

This command's usage comes from `tabularius help sync-log`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius sync-log <folder> <db> [--run ID] [--limit 200] [--json]
                                             The log of what sync-apply sent to FileMaker
```

## Options

`--json`, `--limit`, `--run`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius sync-log --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
