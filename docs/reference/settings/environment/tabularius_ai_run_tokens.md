# TABULARIUS_AI_RUN_TOKENS

A strict cap on tokens one assistant question may use; a model call that could take it past the cap is not made.

| Setting | Value |
| --- | --- |
| Default | 300000 |
| Accepted values | Positive number of tokens |
| Restart needed | Yes for a running server. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/cli/src/main.ts:1402](../../../../packages/cli/src/main.ts#L1402) |

[All environment variables](../../../environment-variables.md)
