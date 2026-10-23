# tabularius compat-check

This command's usage comes from `tabularius help compat-check`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius compat-check <folder> <database>
                                             Read-only list of native features a compat export would lose;
                                             one finding per line, exit 1 if any are found
```

## Options

No command options are listed.

## Exit codes

0 when no native feature lacks a compat path; 1 when there are findings or on error.

## Tested CLI example

```sh
tabularius compat-check ./data Invoices
```

This example is executed by the CLI reference test.

[All commands](index.md)
