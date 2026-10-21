# tabularius diagnostics

This command's usage comes from `tabularius help diagnostics`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius diagnostics [<folder>] [--out <file.zip|folder>] [--include-names] [--full]
                                             Collect what a bug report needs and nothing it must not
                                             carry: versions, system, settings that are switches or
                                             numbers, file sizes and design counts, the doctor checks,
                                             and the last 500 lines of the Event and ScriptEvent logs
                                             with names, addresses, secrets and anything quoted hidden.
                                             Never records, passwords, tokens or file names (unless
                                             --include-names). Writes a .zip of plain text to read
                                             before you send it; changes nothing else
```

## Options

`--full`, `--include-names`, `--out`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius diagnostics --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
