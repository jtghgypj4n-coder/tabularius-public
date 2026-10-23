# tabularius serve --ldap-bind-dn-template

`--ldap-bind-dn-template` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Unset |
| Accepted values | LDAP distinguished name, template, attribute, or password as named by the variable |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_LDAP_BIND_DN_TEMPLATE`](../environment/tabularius_ldap_bind_dn_template.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1402](../../../../packages/cli/src/main.ts#L1402) |

[All serve flags](../serve-flags.md)
