# tabularius calendar-feed

This command's usage comes from `tabularius help calendar-feed`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius calendar-feed <folder> <database> create --account A --layout L --start FIELD [--end F] [--title F] [--description F] [--location F]
                                             [--zone UTC|Europe/London] [--query '[{"Status":"open"}]'] [--limit N] [--label L]
                                             [--expires-days N|0] [--public-url https://host] [--json]
                                             A calendar link for a layout's date field: a read-only API token
                                             scoped to that layout, as <account>, and the address that carries
                                             the field choices. The address is shown once, as a token is.
      ... list [--json]                      The feeds in the file (never an address)
      ... revoke <id>                        End a feed's link
```

## Options

`--account`, `--description`, `--end`, `--expires-days`, `--json`, `--label`, `--layout`, `--limit`, `--location`, `--public-url`, `--query`, `--start`, `--title`, `--zone`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius calendar-feed --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
