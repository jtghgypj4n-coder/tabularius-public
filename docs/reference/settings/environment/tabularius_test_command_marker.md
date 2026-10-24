# TABULARIUS_TEST_COMMAND_MARKER

Internal to `scripts/test-auth-review-round2.ts`: the runner sets a temporary marker path for its forbidden-command stubs (`launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, `sudo`). A stub writes the marker if invoked, causing the audit to fail. No manual setting is needed.

| Setting | Value |
| --- | --- |
| Default | Unset |
| Accepted values | Temporary marker file path |
| Restart needed | No server restart; a new command reads it on invocation. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [scripts/test-auth-review-round2.ts:29](../../../../scripts/test-auth-review-round2.ts#L29) |

[All environment variables](../../../environment-variables.md)
