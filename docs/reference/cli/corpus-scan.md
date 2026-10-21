# tabularius corpus-scan

This command's usage comes from `tabularius help corpus-scan`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius corpus-scan <folder> [--out DIR] [--convert] [--dedupe-only] [--all] [--list FILE] [--only ANON-ID] [--jobs N] [--timeout SECONDS]
                                             Count what a collection of .fmp12 files uses:
                                             plug-in calls, functions, Get ( ) options, script
                                             steps, layout objects, triggers; --convert also
                                             tries converting each. Duplicates (same content)
                                             are scanned once (--dedupe-only: just count them,
                                             comparing same-size files only; --all: also walk
                                             Library, System and Applications folders; --list: scan
                                             the .fmp12 paths in FILE, one per line, instead
                                             of walking a folder). Writes corpus-report.json and
                                             .md: counts and masked formula shapes only, no
                                             file names, record data or names
```

## Options

`--all`, `--convert`, `--dedupe-only`, `--jobs`, `--list`, `--only`, `--out`, `--timeout`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius corpus-scan --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
