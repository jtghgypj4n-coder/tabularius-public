# TABULARIUS_PGWIRE_MAX_BUFFERED_ROWS

Combined result rows that one SQL connection may hold in portals.

| Setting | Value |
| --- | --- |
| Default | 100000 |
| Accepted values | Positive whole number of rows |
| Restart needed | Yes; restart the server after changing its environment. |
| Explained in | [docs/pgwire-results.md](../../../pgwire-results.md) |
| Code | [packages/server/src/pgwire.ts:1139](../../../../packages/server/src/pgwire.ts#L1139) |

[All environment variables](../../../environment-variables.md)
