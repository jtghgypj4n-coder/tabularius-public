# TABULARIUS_SQL_WRITES

1 lets the SQL connection run INSERT, UPDATE and DELETE (off by default); needs the SQL port.

| Setting | Value |
| --- | --- |
| Default | Off: the SQL connection is read-only |
| Accepted values | 1, true, yes or on; 0, false, no, off or empty for off; anything else stops `serve` |
| Restart needed | Yes for a running server. |
| Explained in | [docs/pgwire-writes.md](../../../pgwire-writes.md) |
| Code | [packages/cli/src/main.ts:1376](../../../../packages/cli/src/main.ts#L1376) |

[All environment variables](../../../environment-variables.md)
