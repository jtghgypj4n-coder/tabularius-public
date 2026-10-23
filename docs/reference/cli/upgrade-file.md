# tabularius upgrade-file

This command's usage comes from `tabularius help upgrade-file`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius upgrade-file <folder> <database> --to native [--apply]
                                             Preview a one-way compat-to-native upgrade; --apply backs
                                             up the hosted folder first, then converts stored dates to ISO
```

## Options

`--apply`, `--to`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius upgrade-file ./data Invoices --to native
```

This example is executed by the CLI reference test.

[All commands](index.md)
