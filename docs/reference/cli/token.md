# tabularius token

This command's usage comes from `tabularius help token`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius token <folder> <database> create <account> [--label L] [--read-only] [--expires-days N|0] [--surfaces fmrest,fmodata,fmxdbc] [--layouts L1,L2,...]
                                             A revocable API token for an integration, acting as
                                             <account> (use it as a Bearer token on the Data API
                                             and SQL). Shown once. --read-only forbids writes. It stops
                                             working after 90 days unless --expires-days says otherwise
                                             (0 for none).
                                             --layouts limits it to those Data API layouts (and
                                             only the Data API; OData and SQL refuse it).
      ... list                               The file's tokens (never the secret)
      ... revoke <id>                        Revoke a token by its id
```

## Options

`--expires-days`, `--label`, `--layouts`, `--read-only`, `--surfaces`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius token --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
