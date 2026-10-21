# TABULARIUS_TRACE_SQL_MIN_MS

With `TABULARIUS_TRACE_SQL` set, logs only statements that took this many milliseconds or more.

| Setting | Value |
| --- | --- |
| Default | 0 ms |
| Accepted values | Nonnegative milliseconds |
| Restart needed | Yes; restart the server after changing its environment. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/store/src/trace.ts:44](../../../../packages/store/src/trace.ts#L44) |

[All environment variables](../../../environment-variables.md)
