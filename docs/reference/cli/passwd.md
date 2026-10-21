# tabularius passwd

This command's usage comes from `tabularius help passwd`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius passwd <folder> <database> <account> [--privilege-set S] [--must-change]
                                             Set an account's password (read from
                                             TABULARIUS_PASSWORD or stdin; at least 12
                                             characters unless the file's policy says
                                             otherwise); new accounts need a privilege set. --must-change makes
                                             the person set a new one at next sign-in
```

## Options

`--must-change`, `--privilege-set`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius passwd --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
