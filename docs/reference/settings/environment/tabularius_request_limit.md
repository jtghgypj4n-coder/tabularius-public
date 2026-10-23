# TABULARIUS_REQUEST_LIMIT

How many requests each worker runs at once before further ones wait in a queue (32 by default, at least 4). Two of the slots are kept for sign-in and static files. See [Performance](../../../performance.md).

| Setting | Value |
| --- | --- |
| Default | 32 |
| Accepted values | Whole number of 4 or more; decimal digits only for numbers, within the safe integer range |
| Restart needed | Yes for a running server. |
| Explained in | [docs/performance.md](../../../performance.md) |
| Code | [packages/server/src/request-gate.ts:43](../../../../packages/server/src/request-gate.ts#L43) |

[All environment variables](../../../environment-variables.md)
