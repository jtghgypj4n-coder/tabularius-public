# tabularius api-types

This command's usage comes from `tabularius help api-types`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius api-types
                                             Print TypeScript types for the Data API and OData (a .d.ts),
                                             written from the server's own OpenAPI description:
                                             tabularius api-types > tabularius-api.d.ts. The description
                                             itself is at /fmi/data/openapi.json on a running server.
                                             Needs no file; changes nothing
```

## Options

No command options are listed.

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius api-types --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
