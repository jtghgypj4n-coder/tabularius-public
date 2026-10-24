# TABULARIUS_TOKEN_DEFAULT_DAYS

Days an API or AI-app token lives when no lifetime is asked for (calendar feed addresses keep their own default).

| Setting | Value |
| --- | --- |
| Default | 90 days |
| Accepted values | Whole or decimal number of days above 0 and up to 3650; anything else keeps 90 |
| Restart needed | No server restart; read when a token is made. |
| Explained in | [docs/security-defaults.md](../../../security-defaults.md) |
| Code | [packages/server/src/token-expiry.ts:17](../../../../packages/server/src/token-expiry.ts#L17) |

[All environment variables](../../../environment-variables.md)
