# TABULARIUS_MAX_UPLOAD_IN_PROGRESS

Combined byte reservation allowed across ongoing uploads and conversions.

| Setting | Value |
| --- | --- |
| Default | 20 GiB |
| Accepted values | Positive safe whole bytes, decimal digits only; 0 or invalid uses the default with a warning |
| Restart needed | Yes for a running server. |
| Explained in | [ADMIN.md](../../../../ADMIN.md) |
| Code | [packages/server/src/uploads.ts:46](../../../../packages/server/src/uploads.ts#L46) |

[All environment variables](../../../environment-variables.md)
