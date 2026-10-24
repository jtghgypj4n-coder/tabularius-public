# TABULARIUS_PGWIRE_MAX_ROWS

Maximum rows a SQL query may return.

| Setting | Value |
| --- | --- |
| Default | 100000 |
| Accepted values | Nonnegative whole number of rows; 0 removes the cap |
| Restart needed | Yes; restart the server after changing its environment. |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/server/src/pgwire.ts:51](../../../../packages/server/src/pgwire.ts#L51) |

[All environment variables](../../../environment-variables.md)
