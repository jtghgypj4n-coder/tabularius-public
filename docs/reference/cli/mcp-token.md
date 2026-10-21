# tabularius mcp-token

This command's usage comes from `tabularius help mcp-token`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius mcp-token <folder>              Print the token an AI app presents at /mcp to work as
                                             the administrator (Authorization: Bearer ...). The server
                                             makes it on first start; it is kept in the folder in a
                                             file only your account can read. --mcp-token sets another
                                             token for a server instead.
```

## Options

`--mcp-token`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius mcp-token --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
