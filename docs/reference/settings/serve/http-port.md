# tabularius serve --http-port

`--http-port` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | 80 |
| Accepted values | Port from 0 to 65535 |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_HTTP_PORT`](../environment/tabularius_http_port.md) |
| Explained in | [docs/reference/settings/serve-flags.md](../serve-flags.md) |
| Code | [packages/cli/src/main.ts:1282](../../../../packages/cli/src/main.ts#L1282) |

[All serve flags](../serve-flags.md)
