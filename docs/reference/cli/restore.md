# tabularius restore

This command's usage comes from `tabularius help restore`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius restore <folder> <backup-set> [database] [--accept-account-changes]
                                             Put back files from a backup set (stop the server
                                             first; encrypted sets need TABULARIUS_BACKUP_KEY).
                                             Lists accounts that differ from the file it replaces
                                             and stops until you add --accept-account-changes.
                                             A set without a signature (encrypted before
                                             signatures, or one removed) needs
                                             --accept-unsigned-backup, or verify-backup --sign
  tabularius restore <folder> --at "2026-10-11 14:05" [database] [--from DIR | s3://bucket/prefix] [--accept-account-changes]
                                             Put back files as they were at a moment (with
                                             serve --progressive, to the minute it saves changes;
                                             --accept-unsigned-backup as for a set)
```

## Options

`--accept-account-changes`, `--accept-unsigned-backup`, `--at`, `--from`, `--progressive`, `--sign`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius restore --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
