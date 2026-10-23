# tabularius serve --ai-run-tokens

`--ai-run-tokens` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | 300000 |
| Accepted values | Whole number of tokens, 1 to 10,000,000 |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_AI_RUN_TOKENS`](../environment/tabularius_ai_run_tokens.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1403](../../../../packages/cli/src/main.ts#L1403) |

[All serve flags](../serve-flags.md)
