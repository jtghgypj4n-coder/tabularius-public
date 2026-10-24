# tabularius serve --ldap-url

`--ldap-url` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | LDAP sign-in off |
| Accepted values | ldaps:// URL |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_LDAP_URL`](../environment/tabularius_ldap_url.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1407](../../../../packages/cli/src/main.ts#L1407) |

[All serve flags](../serve-flags.md)
