# tabularius serve --log-limit

`--log-limit` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | 40MB |
| Accepted values | Byte size such as 40MB |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_LOG_LIMIT`](../environment/tabularius_log_limit.md) |
| Explained in | [ADMIN.md](../../../../ADMIN.md) |
| Code | [packages/cli/src/main.ts:1334](../../../../packages/cli/src/main.ts#L1334) |

[All serve flags](../serve-flags.md)
