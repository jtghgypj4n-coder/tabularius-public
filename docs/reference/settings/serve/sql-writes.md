# tabularius serve --sql-writes

`--sql-writes` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Off: the SQL connection is read-only |
| Accepted values | No value (a switch) |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | No direct environment equivalent |
| Explained in | [docs/pgwire-writes.md](../../../pgwire-writes.md) |
| Code | [packages/cli/src/main.ts:1349](../../../../packages/cli/src/main.ts#L1349) |

[All serve flags](../serve-flags.md)
