# tabularius migrate-fms

This command's usage comes from `tabularius help migrate-fms`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius migrate-fms <folder> [--fms-dir DIR] [--from URL|export.json] [--user admin] [--insecure]
                [--save export.json] [--dry-run]
                                             Switch from FileMaker Server in one step: its hosted
                                             files and their container folders (from --fms-dir,
                                             its install folder), script schedules, backup
                                             schedule and SSL certificate (CStore; key passphrase
                                             in TABULARIUS_FMS_KEY_PASSPHRASE) into <folder>.
                                             --from reads schedules and the file list from its
                                             Admin API (password in TABULARIUS_FMS_PASSWORD or
                                             stdin) or a file --save wrote; serve then picks up
                                             the backup and certificate settings
```

## Options

`--dry-run`, `--fms-dir`, `--from`, `--insecure`, `--save`, `--user`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius migrate-fms --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
