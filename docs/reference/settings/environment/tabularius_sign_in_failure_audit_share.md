# TABULARIUS_SIGN_IN_FAILURE_AUDIT_SHARE

The most of a file's security audit that failed sign-in rows may fill, after the first 1,000 of them. Past it they are not written, so a flood of wrong passwords cannot bury real events. Lockout rows are always written, and a lockout still locks. The per-account usage report and the failed-burst alert then see fewer failures (the access log has them all). Each server process counts the audit once a minute, so several processes can overshoot the share by what they write in that minute.

| Setting | Value |
| --- | --- |
| Default | 0.8 |
| Accepted values | Plain decimal number from 0 to 1 (1 for no limit); anything else, such as hex or an exponent, keeps 0.8 |
| Restart needed | Yes for a running server. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [packages/store/src/sign-in-failures.ts:20](../../../../packages/store/src/sign-in-failures.ts#L20) |

[All environment variables](../../../environment-variables.md)
