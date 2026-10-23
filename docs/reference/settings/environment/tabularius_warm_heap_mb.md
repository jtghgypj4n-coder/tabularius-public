# TABULARIUS_WARM_HEAP_MB

Memory budget for the background warming worker, in MB.

| Setting | Value |
| --- | --- |
| Default | 1536 MB |
| Accepted values | Positive safe whole MB, decimal digits only; values below 256 use 256 |
| Restart needed | Yes for a running server. |
| Explained in | [ADMIN.md](../../../../ADMIN.md) |
| Code | [packages/server/src/warmer.ts:18](../../../../packages/server/src/warmer.ts#L18) |

[All environment variables](../../../environment-variables.md)
