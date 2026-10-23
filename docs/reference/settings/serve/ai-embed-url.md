# tabularius serve --ai-embed-url

`--ai-embed-url` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Embedding service off |
| Accepted values | ollama, lmstudio, or an embedding endpoint URL |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_AI_EMBED_URL`](../environment/tabularius_ai_embed_url.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1207](../../../../packages/cli/src/main.ts#L1207) |

[All serve flags](../serve-flags.md)
