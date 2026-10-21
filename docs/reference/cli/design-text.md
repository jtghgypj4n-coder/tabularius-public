# tabularius design-text

This command's usage comes from `tabularius help design-text`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius design-text <folder> <database> <out-dir>
  tabularius design-text <file.fmp12> <out-dir>
                                             The design as small text files (tables, scripts,
                                             layouts, value lists, custom functions, privilege
                                             sets), one per object, to keep in git and diff. No
                                             record data or passwords. Run again to update
```

## Options

No command options are listed.

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius design-text --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
