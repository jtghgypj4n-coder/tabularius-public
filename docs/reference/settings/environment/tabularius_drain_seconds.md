# TABULARIUS_DRAIN_SECONDS

How long a stopping server lets requests that are already running finish before it closes them (1 to 86400, 20 by default; see [Upgrading](../../../upgrading.md), "Stopping and restarting").

| Setting | Value |
| --- | --- |
| Default | 20 seconds |
| Accepted values | 1 to 86400 |
| Restart needed | Yes for a running server. |
| Explained in | [docs/upgrading.md](../../../upgrading.md) |
| Code | [packages/cli/src/main.ts:1452](../../../../packages/cli/src/main.ts#L1452) |

[All environment variables](../../../environment-variables.md)
