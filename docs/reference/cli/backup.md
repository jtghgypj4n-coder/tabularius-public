# tabularius backup

This command's usage comes from `tabularius help backup`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius backup <folder> [--to DIR] [--keep 7]
                                             Back up every hosted file now (safe while serving);
                                             encrypted when TABULARIUS_BACKUP_KEY holds a passphrase
```

## Options

`--keep`, `--to`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius backup --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
