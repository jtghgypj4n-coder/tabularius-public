# TABULARIUS_TEST_CHILD_MARKER

Internal to `scripts/test-cross-file-isolation.ts`: the runner sets a temporary marker path for its forbidden-command stubs. A stub writes the marker if invoked, causing the audit to fail. No manual setting is needed.

| Setting | Value |
| --- | --- |
| Default | Unset |
| Accepted values | Temporary marker file path |
| Restart needed | No server restart; a new command reads it on invocation. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [scripts/test-command-stubs.ts:12](../../../../scripts/test-command-stubs.ts#L12) |

[All environment variables](../../../environment-variables.md)
