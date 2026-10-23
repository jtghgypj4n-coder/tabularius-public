# tabularius serve --ldap-group-attribute

`--ldap-group-attribute` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Unset |
| Accepted values | LDAP distinguished name, template, attribute, or password as named by the variable |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_LDAP_GROUP_ATTRIBUTE`](../environment/tabularius_ldap_group_attribute.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1392](../../../../packages/cli/src/main.ts#L1392) |

[All serve flags](../serve-flags.md)
