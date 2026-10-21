# tabularius fidelity

This command's usage comes from `tabularius help fidelity`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius fidelity <folder> <database> [--sql] [--n 200] [--json]
                                             Recompute stored calculations and compare with
                                             what FileMaker stored; --sql only those using
                                             ExecuteSQL, by query shape. Counts only, never
                                             values; read-only; runs no scripts
```

## Options

`--json`, `--n`, `--sql`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius fidelity --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
