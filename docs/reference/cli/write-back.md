# tabularius write-back

This command's usage comes from `tabularius help write-back`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius write-back <folder> <db> <out-dir> [--fmp12 FILE]
                                             Design changes made here since <db> came from
                                             its .fmp12 (in <folder>, or --fmp12), ready to
                                             take back to FileMaker by hand: numbered
                                             clipboard XML files to paste in FileMaker Pro,
                                             and a README.md listing them and the changes to
                                             make by hand. Nothing in FileMaker is touched
```

## Options

`--fmp12`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius write-back --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
