# tabularius compact

This command's usage comes from `tabularius help compact`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius compact <folder> [database] [--json]
                                             Reclaim database and WAL space beside a running server;
                                             SQLite arbitrates writes. The server's timer normally does this.
```

## Options

`--json`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius compact --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
