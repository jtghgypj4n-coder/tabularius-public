# TABULARIUS_ALLOW_PLAIN_HTTP

Lets the server listen beyond this computer over plain HTTP, which it otherwise refuses to do (a proxy or network you control does the HTTPS). Set in the Docker image.

| Setting | Value |
| --- | --- |
| Default | Off: listening beyond this computer needs HTTPS |
| Accepted values | 1, true, yes or on |
| Restart needed | Yes for a running server. |
| Explained in | [docs/security-defaults.md](../../../security-defaults.md) |
| Code | [packages/cli/src/main.ts:1331](../../../../packages/cli/src/main.ts#L1331) |

[All environment variables](../../../environment-variables.md)
