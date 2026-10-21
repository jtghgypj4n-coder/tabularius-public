# tabularius new

This command's usage comes from `tabularius help new`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius new <folder> <database> [--native] [--starter crm|inventory|invoicing|tasks|booking [--no-sample]]
                                     Start a database (no FileMaker file needed), empty or with a ready-to-use app
```

## Options

`--native`, `--no-sample`, `--starter`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius new --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
