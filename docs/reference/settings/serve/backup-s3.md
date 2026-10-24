# tabularius serve --backup-s3

`--backup-s3` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Off |
| Accepted values | s3://bucket/prefix |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_BACKUP_S3`](../environment/tabularius_backup_s3.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1361](../../../../packages/cli/src/main.ts#L1361) |

[All serve flags](../serve-flags.md)
