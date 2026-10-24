# tabularius serve --workers

`--workers` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | One process |
| Accepted values | Whole number from 1 to 64, or auto; decimal digits only for numbers, within the safe integer range |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | No direct environment equivalent |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1476](../../../../packages/cli/src/main.ts#L1476) |

[All serve flags](../serve-flags.md)
