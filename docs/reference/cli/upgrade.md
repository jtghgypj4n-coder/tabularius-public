# tabularius upgrade

This command's usage comes from `tabularius help upgrade`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius upgrade [--no-backup] [--wait 90] [--from <bundle|tarball|folder>]
                                             Update this install in place: new version, backup,
                                             restart, health check, and back to the old version
                                             if the new one doesn't start. --from takes the new
                                             version from a copy instead of GitHub
```

## Options

`--from`, `--no-backup`, `--wait`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius upgrade --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
