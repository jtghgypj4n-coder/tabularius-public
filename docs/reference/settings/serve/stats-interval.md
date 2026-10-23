# tabularius serve --stats-interval

`--stats-interval` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | 1m |
| Accepted values | Interval such as 1m, or off |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_STATS_INTERVAL`](../environment/tabularius_stats_interval.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1340](../../../../packages/cli/src/main.ts#L1340) |

[All serve flags](../serve-flags.md)
