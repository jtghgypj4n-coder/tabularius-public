# tabularius serve --backup-every

`--backup-every` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | 1d |
| Accepted values | off or an interval such as 1d |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_BACKUP_EVERY`](../environment/tabularius_backup_every.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1325](../../../../packages/cli/src/main.ts#L1325) |

[All serve flags](../serve-flags.md)
