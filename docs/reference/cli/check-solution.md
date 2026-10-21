# tabularius check-solution

This command's usage comes from `tabularius help check-solution`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius check-solution <folder> <database> [--json] [--account A] [--fail-on error|warning]
                                             Look through a solution for what is wrong without
                                             running it: calculations that do not parse, scripts,
                                             layouts, fields and value lists that are not there,
                                             steps and plug-ins this build does not run, privilege
                                             sets and accounts that grant nothing. Each finding
                                             says where and how to fix it. Exit 0 clean, 2 when
                                             problems are found, 1 when it could not run. With
                                             --account, also what that account cannot reach
```

## Options

`--account`, `--fail-on`, `--json`

## Exit codes

0 on success; 1 on error; 2 when findings are present.

## Tested CLI example

```sh
tabularius check-solution --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
