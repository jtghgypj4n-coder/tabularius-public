# tabularius layout-census

This command's usage comes from `tabularius help layout-census`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius layout-census <folder> [database] [--json] [--names]
                                             Per kind of layout object, how many there are and
                                             how many Tabularius can't draw or work out (missing
                                             fields, pictures, popovers, formulas that don't
                                             check). Counts only, no values; read-only.
                                             --names adds layout names to the per-layout lists
```

## Options

`--json`, `--names`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius layout-census --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
