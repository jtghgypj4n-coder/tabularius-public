# tabularius serve --capture-only

`--capture-only` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | No capture-only files |
| Accepted values | Comma-separated file name prefixes |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_CAPTURE_ONLY`](../environment/tabularius_capture_only.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:636](../../../../packages/cli/src/main.ts#L636) |

[All serve flags](../serve-flags.md)
