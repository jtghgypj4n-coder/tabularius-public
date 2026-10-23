# TABULARIUS_TRACE_SQL

Enables SQL statement tracing to stderr only for explicit true values. Unrecognized values disable tracing and log one warning per process naming the setting.

| Setting | Value |
| --- | --- |
| Default | Off |
| Accepted values | 1, true, yes, on enable; empty, 0, false, no, off disable (case-insensitive) |
| Restart needed | Yes; restart the server after changing its environment. |
| Explained in | [docs/performance.md](../../../performance.md) |
| Code | [packages/store/src/trace.ts:54](../../../../packages/store/src/trace.ts#L54) |

[All environment variables](../../../environment-variables.md)
