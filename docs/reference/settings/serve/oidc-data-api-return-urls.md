# tabularius serve --oidc-data-api-return-urls

`--oidc-data-api-return-urls` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | No extra return URLs |
| Accepted values | Comma-separated URLs |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_OIDC_DATA_API_RETURN_URLS`](../environment/tabularius_oidc_data_api_return_urls.md) |
| Explained in | [docs/reference/settings/serve-flags.md](../serve-flags.md) |
| Code | [packages/cli/src/main.ts:1408](../../../../packages/cli/src/main.ts#L1408) |

[All serve flags](../serve-flags.md)
