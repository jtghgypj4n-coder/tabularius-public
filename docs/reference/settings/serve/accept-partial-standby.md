# tabularius serve --accept-partial-standby

`--accept-partial-standby` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Off: a failover from an unfinished copy is refused |
| Accepted values | No value (a switch) |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | No direct environment equivalent |
| Explained in | [docs/standby-guarantees.md](../../../standby-guarantees.md) |
| Code | [packages/cli/src/main.ts:1349](../../../../packages/cli/src/main.ts#L1349) |

[All serve flags](../serve-flags.md)
