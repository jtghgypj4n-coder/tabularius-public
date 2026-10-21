# tabularius optimize

This command's usage comes from `tabularius help optimize`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius optimize <folder|file.fmp12> [database] [--json]
                                             Ways to make a file smaller and faster: container
                                             files kept inside it (size by field, for S3 or
                                             external storage instead), sorts no index serves,
                                             fields, scripts and table occurrences nothing uses.
                                             Changes nothing; a .fmp12 is converted to a scratch
                                             copy first, so nothing is hosted
                                             --purge-orphans removes unreferenced container rows
                                             and their external files from a hosted folder
```

## Options

`--json`, `--purge-orphans`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius optimize --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
