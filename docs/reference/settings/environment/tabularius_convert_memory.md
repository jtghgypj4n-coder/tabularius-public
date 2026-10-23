# TABULARIUS_CONVERT_MEMORY

Memory budget for an uploaded file conversion worker, in MB. The memory cap cannot be turned off. Zero, empty or invalid input logs one warning and keeps the 2048 MB default.

| Setting | Value |
| --- | --- |
| Default | 2048 MB |
| Accepted values | Positive safe whole number of MB, decimal digits only; 0 or invalid uses 2048 |
| Restart needed | Yes for a running server. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/server/src/conversion-limits.ts:6](../../../../packages/server/src/conversion-limits.ts#L6) |

[All environment variables](../../../environment-variables.md)
