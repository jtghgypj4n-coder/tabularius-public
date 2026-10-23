# tabularius serve --trusted-proxies

`--trusted-proxies` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | No trusted proxy addresses |
| Accepted values | Comma-separated IP addresses or CIDR ranges |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_TRUSTED_PROXIES`](../environment/tabularius_trusted_proxies.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1304](../../../../packages/cli/src/main.ts#L1304) |

[All serve flags](../serve-flags.md)
