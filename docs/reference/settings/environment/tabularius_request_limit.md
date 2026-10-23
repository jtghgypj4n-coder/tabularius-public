# TABULARIUS_REQUEST_LIMIT

How many requests each worker runs at once before further ones wait in a queue (32 by default, at least 4). Two of the slots are kept for sign-in and static files. See [Performance](../../../performance.md).

| Setting | Value |
| --- | --- |
| Default | 32 |
| Accepted values | Whole number of 4 or more |
| Restart needed | Yes for a running server. |
| Explained in | [docs/performance.md](../../../performance.md) |
| Code | [packages/server/src/index.ts:385](../../../../packages/server/src/index.ts#L385) |

[All environment variables](../../../environment-variables.md)
