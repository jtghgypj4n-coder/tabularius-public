# tabularius serve --workers

`--workers` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | One process |
| Accepted values | Whole number from 1 to 64, or auto |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_WORKERS`](../environment/tabularius_workers.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1433](../../../../packages/cli/src/main.ts#L1433) |

[All serve flags](../serve-flags.md)
