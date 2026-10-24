# TABULARIUS_STOP_GRACE_MS

How long `tabularius service stop` waits for the server to finish before it ends it (30000 by default).

| Setting | Value |
| --- | --- |
| Default | 30000 ms |
| Accepted values | Positive safe whole milliseconds, decimal digits only |
| Restart needed | Yes for a running server. |
| Explained in | [docs/service-files.md](../../../service-files.md) |
| Code | [packages/cli/src/service.ts:488](../../../../packages/cli/src/service.ts#L488) |

[All environment variables](../../../environment-variables.md)
