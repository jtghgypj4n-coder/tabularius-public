# tabularius serve --acme-directory

`--acme-directory` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Default ACME directory |
| Accepted values | ACME directory URL |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_ACME_DIRECTORY`](../environment/tabularius_acme_directory.md) |
| Explained in | [docs/reference/settings/serve-flags.md](../serve-flags.md) |
| Code | [packages/cli/src/main.ts:1281](../../../../packages/cli/src/main.ts#L1281) |

[All serve flags](../serve-flags.md)
