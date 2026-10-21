# tabularius sync-plan

This command's usage comes from `tabularius help sync-plan`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius sync-plan <folder> <db> --config sync.json [--user NAME] [--insecure] [--capture-only F[,F]] [--json]
                                             Preview keeping a FileMaker Server copy of <db> in
                                             step: what would go to FileMaker, what would come
                                             here, and the conflicts held for review. Read only:
                                             nothing is written on either side. sync.json names
                                             the server, its file and each table's layout, UUID
                                             field and modification timestamp field (ADMIN.md);
                                             password in TABULARIUS_FMS_PASSWORD or typed
```

## Options

`--capture-only`, `--config`, `--insecure`, `--json`, `--user`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius sync-plan --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
