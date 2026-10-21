# tabularius design-diff

This command's usage comes from `tabularius help design-diff`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius design-diff <old> <new> [--exit-code]
                                             A readable difference between two designs, for a code
                                             review: scripts step by step, tables field by field,
                                             layouts object by object, relationships by name. Each
                                             side is a folder design-text wrote, a .fmp12 file or a
                                             hosted .openhbam.sqlite file. --exit-code: exit 1 when
                                             they differ. Changes nothing
```

## Options

`--exit-code`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius design-diff --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
