# TABULARIUS_CONTAINER_TTL

Lifetime of a signed container URL.

| Setting | Value |
| --- | --- |
| Default | 3600 seconds |
| Accepted values | Positive seconds up to 3600, which is also what any other value (0, negative, not a number, longer) gives; a link signed for more than an hour ahead is refused |
| Restart needed | Yes for a running server. |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/server/src/host.ts:71](../../../../packages/server/src/host.ts#L71) |

[All environment variables](../../../environment-variables.md)
