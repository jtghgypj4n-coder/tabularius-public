# TABULARIUS_FIXTURE_CACHE

Where `npm run fixtures` keeps downloaded fixture files between checkouts (`~/.cache/tabularius-fixtures` by default).

| Setting | Value |
| --- | --- |
| Default | ~/.cache/tabularius-fixtures |
| Accepted values | Directory path |
| Restart needed | No server restart; a new command reads it on invocation. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [scripts/fetch-fixtures.ts:39](../../../../scripts/fetch-fixtures.ts#L39) |

[All environment variables](../../../environment-variables.md)
