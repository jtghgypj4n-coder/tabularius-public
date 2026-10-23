# tabularius serve --keep-api-tokens-on-takeover

`--keep-api-tokens-on-takeover` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Off: API tokens end when a standby takes over |
| Accepted values | No value (a switch) |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | No direct environment equivalent |
| Explained in | [docs/standby-guarantees.md](../../../standby-guarantees.md) |
| Code | [packages/cli/src/main.ts:1375](../../../../packages/cli/src/main.ts#L1375) |

[All serve flags](../serve-flags.md)
