# tabularius serve --ldap-name

`--ldap-name` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Hostname of the configured LDAP URL |
| Accepted values | Display name |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_LDAP_NAME`](../environment/tabularius_ldap_name.md) |
| Explained in | [docs/reference/settings/serve-flags.md](../serve-flags.md) |
| Code | [packages/cli/src/main.ts:1379](../../../../packages/cli/src/main.ts#L1379) |

[All serve flags](../serve-flags.md)
