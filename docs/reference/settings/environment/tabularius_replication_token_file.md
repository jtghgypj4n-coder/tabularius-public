# TABULARIUS_REPLICATION_TOKEN_FILE

A private regular file holding the replication token; the primary requires at least 16 characters.

| Setting | Value |
| --- | --- |
| Default | Replication off |
| Accepted values | File path (the file must not be readable by other users) |
| Restart needed | Yes for a running server. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/cli/src/main.ts:1379](../../../../packages/cli/src/main.ts#L1379) |

[All environment variables](../../../environment-variables.md)
