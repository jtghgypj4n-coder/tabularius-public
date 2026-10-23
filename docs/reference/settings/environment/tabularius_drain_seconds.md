# TABULARIUS_DRAIN_SECONDS

How long a stopping server lets requests that are already running finish before it closes them (1 to 86400, 20 by default; see [Upgrading](../../../upgrading.md), "Stopping and restarting").

| Setting | Value |
| --- | --- |
| Default | 20 seconds |
| Accepted values | Whole seconds from 1 to 86400, decimal digits only |
| Restart needed | Yes for a running server. |
| Explained in | [docs/upgrading.md](../../../upgrading.md) |
| Code | [packages/cli/src/main.ts:1477](../../../../packages/cli/src/main.ts#L1477) |

[All environment variables](../../../environment-variables.md)
