# TABULARIUS_TRACE_SQL

Enables SQL statement tracing to stderr. A value that is neither a switch-on nor a switch-off word stops `serve`, naming the setting.

| Setting | Value |
| --- | --- |
| Default | Off |
| Accepted values | 1, true, yes or on to trace; 0, false, no, off or empty for off; anything else stops the start |
| Restart needed | Yes; restart the server after changing its environment. |
| Explained in | [docs/performance.md](../../../performance.md) |
| Code | [packages/store/src/trace.ts:54](../../../../packages/store/src/trace.ts#L54) |

[All environment variables](../../../environment-variables.md)
