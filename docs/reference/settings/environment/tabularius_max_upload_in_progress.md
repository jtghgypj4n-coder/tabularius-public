# TABULARIUS_MAX_UPLOAD_IN_PROGRESS

Combined byte reservation allowed across ongoing uploads and conversions.

| Setting | Value |
| --- | --- |
| Default | 20 GiB |
| Accepted values | Positive safe whole bytes, decimal digits only; 0, empty or anything else is refused |
| Restart needed | Yes for a running server. |
| Explained in | [ADMIN.md](../../../../ADMIN.md) |
| Code | [packages/server/src/uploads.ts:47](../../../../packages/server/src/uploads.ts#L47) |

[All environment variables](../../../environment-variables.md)
