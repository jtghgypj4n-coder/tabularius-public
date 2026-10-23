# TABULARIUS_CONVERT_MEMORY

Memory budget for an uploaded file conversion worker, in MB. The memory cap cannot be turned off: zero, empty or a value that is not digits only stops `serve`.

| Setting | Value |
| --- | --- |
| Default | 2048 MB |
| Accepted values | Whole number of MB, 64 or more; 0 and anything that is not digits only stop `serve` (the heap is always capped) |
| Restart needed | Yes for a running server. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/server/src/conversion-limits.ts:7](../../../../packages/server/src/conversion-limits.ts#L7) |

[All environment variables](../../../environment-variables.md)
