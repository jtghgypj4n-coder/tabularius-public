# TABULARIUS_PGWIRE_TX_MAX_MS

The longest a SQL connection may keep one transaction open, however busy it is, in milliseconds. Only matters with --sql-writes.

| Setting | Value |
| --- | --- |
| Default | 300000 |
| Accepted values | Nonnegative whole number of milliseconds; 0 for no limit |
| Restart needed | No server restart; read when a SQL connection begins a transaction. |
| Explained in | [docs/pgwire-writes.md](../../../pgwire-writes.md) |
| Code | [packages/server/src/pgwire.ts:248](../../../../packages/server/src/pgwire.ts#L248) |

[All environment variables](../../../environment-variables.md)
