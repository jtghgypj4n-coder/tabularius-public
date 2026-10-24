# tabularius serve --keep

`--keep` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | 7 |
| Accepted values | Whole number of 1 or more; decimal digits only for numbers, within the safe integer range |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_BACKUP_KEEP`](../environment/tabularius_backup_keep.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1158](../../../../packages/cli/src/main.ts#L1158) |

[All serve flags](../serve-flags.md)
