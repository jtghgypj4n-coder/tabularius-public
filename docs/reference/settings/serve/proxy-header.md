# tabularius serve --proxy-header

`--proxy-header` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Unset |
| Accepted values | x-forwarded-for, forwarded, or x-real-ip |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_PROXY_HEADER`](../environment/tabularius_proxy_header.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1335](../../../../packages/cli/src/main.ts#L1335) |

[All serve flags](../serve-flags.md)
