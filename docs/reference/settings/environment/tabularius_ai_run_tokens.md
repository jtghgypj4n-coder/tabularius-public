# TABULARIUS_AI_RUN_TOKENS

A strict cap on tokens one assistant question may use; a model call that could take it past the cap is not made.

| Setting | Value |
| --- | --- |
| Default | 300000 |
| Accepted values | Whole number of tokens, 1 to 10,000,000 |
| Restart needed | Yes for a running server. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/cli/src/main.ts:1427](../../../../packages/cli/src/main.ts#L1427) |

[All environment variables](../../../environment-variables.md)
