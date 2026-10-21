# tabularius script-tests

This command's usage comes from `tabularius help script-tests`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius script-tests <folder> [database] [--script NAME]... [--json]
                                             Run the script test cases saved with each file
                                             (the script editor's Tests) offline, each on a
                                             trial whose changes are undone, with the case's
                                             own AI answers instead of a model. Lists each
                                             case and what differs; exits 1 if any fails,
                                             for CI. A capture-only file is run only
                                             when named
```

## Options

`--json`, `--script`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius script-tests --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
