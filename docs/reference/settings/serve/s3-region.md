# tabularius serve --s3-region

`--s3-region` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | AWS_REGION or the provider default |
| Accepted values | S3 region name |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_S3_REGION`](../environment/tabularius_s3_region.md) |
| Explained in | [docs/reference/settings/serve-flags.md](../serve-flags.md) |
| Code | [packages/cli/src/main.ts:1330](../../../../packages/cli/src/main.ts#L1330) |

[All serve flags](../serve-flags.md)
