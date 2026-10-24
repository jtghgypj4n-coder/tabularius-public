# tabularius serve --mcp-origin

`--mcp-origin` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | No additional origins |
| Accepted values | Repeatable HTTPS origin without path |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_MCP_ORIGINS`](../environment/tabularius_mcp_origins.md) |
| Explained in | [docs/security-defaults.md](../../../security-defaults.md) |
| Code | [packages/cli/src/main.ts:573](../../../../packages/cli/src/main.ts#L573) |

[All serve flags](../serve-flags.md)
