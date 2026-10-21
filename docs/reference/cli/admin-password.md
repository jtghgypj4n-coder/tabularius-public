# tabularius admin-password

This command's usage comes from `tabularius help admin-password`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius admin-password <folder>         Set the admin console password (/admin/; asks for it
                                             twice, hidden, in a terminal; else read from
                                             TABULARIUS_PASSWORD or stdin). Without one the
                                             console only opens on this machine.
```

## Options

No command options are listed.

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius admin-password --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
