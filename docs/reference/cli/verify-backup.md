# tabularius verify-backup

This command's usage comes from `tabularius help verify-backup`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius verify-backup <folder> [backup-set] [--from DIR] [--sign]
                                             Read backup sets back and check them (all of them
                                             without a set); exits 1 when one is damaged
```

## Options

`--from`, `--sign`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius verify-backup --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
