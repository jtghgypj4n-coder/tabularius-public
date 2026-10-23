# tabularius serve --s3-endpoint

`--s3-endpoint` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | AWS S3 endpoint |
| Accepted values | S3-compatible endpoint URL |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_S3_ENDPOINT`](../environment/tabularius_s3_endpoint.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1348](../../../../packages/cli/src/main.ts#L1348) |

[All serve flags](../serve-flags.md)
