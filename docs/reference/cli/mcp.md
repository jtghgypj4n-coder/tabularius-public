# tabularius mcp

This command's usage comes from `tabularius help mcp`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius mcp <folder> [--account A]      MCP over stdio, for desktop AI apps; with an
                                             account (password in TABULARIUS_PASSWORD), the
                                             AI works within its privilege set;
                                             --ai-exclude A,B keeps those files from it
```

## Options

`--account`, `--ai-exclude`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius mcp --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
