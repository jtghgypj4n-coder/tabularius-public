# TABULARIUS_DATA_API_MAX_LIMIT

Largest record count one Data API request may ask for.

| Setting | Value |
| --- | --- |
| Default | 10000 records |
| Accepted values | Nonnegative whole number; 0 removes the cap |
| Restart needed | Yes; restart the server after changing its environment. |
| Explained in | [docs/data-api-compatibility.md](../../../data-api-compatibility.md) |
| Code | [packages/server/src/dataapi.ts:220](../../../../packages/server/src/dataapi.ts#L220) |

[All environment variables](../../../environment-variables.md)
