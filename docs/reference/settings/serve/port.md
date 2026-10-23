# tabularius serve --port

`--port` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | 8080, or 443 with automatic HTTPS |
| Accepted values | Port number from 0 to 65535 |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | `PORT` |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1016](../../../../packages/cli/src/main.ts#L1016) |

[All serve flags](../serve-flags.md)
