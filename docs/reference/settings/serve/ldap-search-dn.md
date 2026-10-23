# tabularius serve --ldap-search-dn

`--ldap-search-dn` is a serve option. The full command usage is in [serve](../../cli/serve.md).

| Setting | Value |
| --- | --- |
| Default | Unset |
| Accepted values | LDAP distinguished name, template, attribute, or password as named by the variable |
| Restart needed | Yes; serve flags are read when the server starts. |
| Environment | [`TABULARIUS_LDAP_SEARCH_DN`](../environment/tabularius_ldap_search_dn.md) |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/cli/src/main.ts:1381](../../../../packages/cli/src/main.ts#L1381) |

[All serve flags](../serve-flags.md)
