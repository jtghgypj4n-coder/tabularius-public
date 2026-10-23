# TABULARIUS_PROXY_HEADER

The header a trusted proxy puts the client address in.

| Setting | Value |
| --- | --- |
| Default | No proxy header trusted |
| Accepted values | x-forwarded-for, forwarded, or x-real-ip |
| Restart needed | Yes for a running server. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/cli/src/main.ts:1326](../../../../packages/cli/src/main.ts#L1326) |

[All environment variables](../../../environment-variables.md)
