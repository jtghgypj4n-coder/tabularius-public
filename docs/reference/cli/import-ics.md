# tabularius import-ics

This command's usage comes from `tabularius help import-ics`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius import-ics <folder> <database> <file.ics> --account A --layout L --start FIELD [--end F] [--title F] [--description F] [--location F]
                                             [--uid F] [--zone UTC|Europe/London] [--json]
                                             Read an iCalendar file into a layout's records, one per event, all or none,
                                             with <account>'s privileges. Prints what it did.
```

## Options

`--account`, `--description`, `--end`, `--json`, `--layout`, `--location`, `--start`, `--title`, `--uid`, `--zone`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius import-ics --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
