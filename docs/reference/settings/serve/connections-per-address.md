# tabularius serve --connections-per-address

`--connections-per-address` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | 64 |
| Accepted values | Positive safe integer |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_CONNECTIONS_PER_ADDRESS`](../environment/tabularius_connections_per_address.md) |
| Explained in | [ADMIN.md](../../../../ADMIN.md) |
| Code | [packages/cli/src/main.ts:1326](../../../../packages/cli/src/main.ts#L1326) |

[All serve flags](../serve-flags.md)
