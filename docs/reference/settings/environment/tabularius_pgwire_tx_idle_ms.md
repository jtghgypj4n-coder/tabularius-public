# TABULARIUS_PGWIRE_TX_IDLE_MS

How long a SQL connection may sit idle inside BEGIN, in milliseconds, before it is rolled back and closed. Only matters with --sql-writes.

| Setting | Value |
| --- | --- |
| Default | 30000 |
| Accepted values | Nonnegative whole number of milliseconds; 0 for no limit |
| Restart needed | No server restart; read when a SQL connection begins a transaction. |
| Explained in | [docs/pgwire-writes.md](../../../pgwire-writes.md) |
| Code | [packages/server/src/pgwire.ts:245](../../../../packages/server/src/pgwire.ts#L245) |

[All environment variables](../../../environment-variables.md)
