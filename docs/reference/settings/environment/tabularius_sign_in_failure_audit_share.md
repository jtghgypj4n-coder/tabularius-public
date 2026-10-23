# TABULARIUS_SIGN_IN_FAILURE_AUDIT_SHARE

The most of a file's security audit that failed sign-ins and the lockouts they cause may fill, after the first 1,000 of them. Past it they are not written, so a flood of wrong passwords cannot bury real events; a lockout still locks. The per-account usage report and the failed-burst alert then see fewer failures (the access log has them all).

| Setting | Value |
| --- | --- |
| Default | 0.8 |
| Accepted values | Number from 0 to 1 (1 for no limit); anything else keeps 0.8 |
| Restart needed | Yes for a running server. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/store/src/sign-in-failures.ts:18](../../../../packages/store/src/sign-in-failures.ts#L18) |

[All environment variables](../../../environment-variables.md)
