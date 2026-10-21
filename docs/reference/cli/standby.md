# tabularius standby

This command's usage comes from `tabularius help standby`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius standby <folder> --primary URL [--token T|--token-file F] [--overwrite]
                                             Keep copies of another server's files a second
                                             or so behind it (it runs serve --replication-token
                                             T; token also in TABULARIUS_REPLICATION_TOKEN or
                                             TABULARIUS_REPLICATION_TOKEN_FILE). To
                                             take over, stop this and serve the folder (its API
                                             tokens are ended unless serve gets
                                             --keep-api-tokens-on-takeover). Copies that did not
                                             reach a whole state are refused unless serve gets
                                             --accept-partial-standby.
```

## Options

`--accept-partial-standby`, `--keep-api-tokens-on-takeover`, `--overwrite`, `--primary`, `--replication-token`, `--token`, `--token-file`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius standby --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
