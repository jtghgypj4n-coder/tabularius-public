# tabularius serve --ai-workspace-id

`--ai-workspace-id` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | ~/.openhbam/anthropic-workspace-id if available |
| Accepted values | Workspace id |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_AI_WORKSPACE_ID`](../environment/tabularius_ai_workspace_id.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1420](../../../../packages/cli/src/main.ts#L1420) |

[All serve flags](../serve-flags.md)
