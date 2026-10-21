# tabularius sync-apply

This command's usage comes from `tabularius help sync-apply`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius sync-apply <folder> <db> --config sync.json [--write] [--pull] [--containers] [--resolve POLICY] [--allow-deletes]
                [--keep-related] [--user NAME] [--insecure] [--capture-only F[,F]] [--release] [--json]
                                             Send the records sync-plan says go to FileMaker
                                             Server (--write), and/or bring FileMaker's changes
                                             here (--pull). With neither it is a dry run. --write
                                             also needs "allowWrites": true in sync.json; both stop with
                                             nothing sent if the plan holds any conflict (settle
                                             them with a table's policy, or --resolve
                                             tabularius-wins|filemaker-wins|newer-wins for tables
                                             that hold them), and hold deletions unless
                                             --allow-deletes (a deletion brought here also deletes
                                             the records this file's relationships delete with it;
                                             --keep-related leaves them). Every write is logged; run it
                                             again to carry on after a stop. Never for
                                             capture-only files. --release lets a table an
                                             earlier run held back write again
```

## Options

`--allow-deletes`, `--capture-only`, `--config`, `--containers`, `--insecure`, `--json`, `--keep-related`, `--pull`, `--release`, `--resolve`, `--user`, `--write`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius sync-apply --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
