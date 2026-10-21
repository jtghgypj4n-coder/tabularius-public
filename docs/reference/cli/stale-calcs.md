# tabularius stale-calcs

This command's usage comes from `tabularius help stale-calcs`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius stale-calcs <folder> <database> [--table T] [--n 10000] [--json]
                                             Count, per field, stored calculations whose saved
                                             value is no longer what the formula gives now.
                                             Counts only; changes nothing
```

## Options

`--json`, `--n`, `--table`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius stale-calcs --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
