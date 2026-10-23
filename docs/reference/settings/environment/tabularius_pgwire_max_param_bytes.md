# TABULARIUS_PGWIRE_MAX_PARAM_BYTES

Total bound parameter bytes that one SQL connection's portals may hold.

| Setting | Value |
| --- | --- |
| Default | 67108864 (64 MiB) |
| Accepted values | Positive whole number of bytes; 0 or an invalid value keeps the default |
| Restart needed | No; read at each Bind. |
| Explained in | [docs/pgwire-results.md](../../../pgwire-results.md) |
| Code | [packages/server/src/pgwire.ts:1027](../../../../packages/server/src/pgwire.ts#L1027) |

[All environment variables](../../../environment-variables.md)
