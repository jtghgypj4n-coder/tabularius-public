# tabularius export-sql

This command's usage comes from `tabularius help export-sql`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius export-sql <folder> <database> --out file.sql [--dialect postgres|sqlite] [--account A]
                                             Leave with your data: tables, records, keys and
                                             value lists as a SQL script (container files go
                                             in file.files/ beside it). With --account only
                                             what that account may export. Prints counts only;
                                             refuses to overwrite file.sql
```

## Options

`--account`, `--dialect`, `--out`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius export-sql --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
