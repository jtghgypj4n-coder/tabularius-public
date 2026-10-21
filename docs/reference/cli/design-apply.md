# tabularius design-apply

This command's usage comes from `tabularius help design-apply`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius design-apply <folder> <database> <in-dir> [--apply] [--remove]
                                             Read a folder design-text wrote back: the scripts,
                                             custom functions, value lists and layouts that differ
                                             from the file are listed as changes; --apply makes
                                             them. A file left out removes nothing unless --remove
```

## Options

`--apply`, `--remove`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius design-apply --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
