# tabularius sql-privilege

This command's usage comes from `tabularius help sql-privilege`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius sql-privilege <folder> <name> on|off  Whether SQL reaching <name> through another file needs the fmxdbc privilege in <name> too (off by default)
```

## Options

No command options are listed.

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius sql-privilege --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
