# TABULARIUS_TEST_SMTP

The SMTP account (`smtps://user:pass@host:465`) that `--test-outbound --mail-redirect` sends its one copy through.

| Setting | Value |
| --- | --- |
| Default | TEST_SMTP_FILE contents if present |
| Accepted values | smtps:// URL |
| Restart needed | Yes for a running server. |
| Explained in | [docs/privacy.md](../../../privacy.md) |
| Code | [packages/cli/src/main.ts:646](../../../../packages/cli/src/main.ts#L646) |

[All environment variables](../../../environment-variables.md)
