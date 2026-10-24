# TABULARIUS_MAX_UPLOAD

Largest file accepted by the server upload route, in bytes.

| Setting | Value |
| --- | --- |
| Default | 10 GiB |
| Accepted values | Nonnegative bytes; 0 removes the per-file cap |
| Restart needed | Yes for a running server. |
| Explained in | [ADMIN.md](../../../../ADMIN.md) |
| Code | [packages/server/src/uploads.ts:43](../../../../packages/server/src/uploads.ts#L43) |

[All environment variables](../../../environment-variables.md)
