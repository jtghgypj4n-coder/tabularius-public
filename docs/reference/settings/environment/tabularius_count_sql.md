# TABULARIUS_COUNT_SQL

Counts the prepared statements a store runs and the rows they change, for measuring (scripts/bulk-scale.ts, docs/performance.md).

| Setting | Value |
| --- | --- |
| Default | Off |
| Accepted values | 1 |
| Restart needed | No server restart; read when a store is opened. |
| Explained in | [docs/performance.md](../../../performance.md) |
| Code | [packages/store/src/trace.ts:147](../../../../packages/store/src/trace.ts#L147) |

[All environment variables](../../../environment-variables.md)
