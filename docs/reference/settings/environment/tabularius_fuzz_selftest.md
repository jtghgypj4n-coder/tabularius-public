# TABULARIUS_FUZZ_SELFTEST

Internal to the fuzz harness (`scripts/fuzz/worker.ts`): `error`, `hang`, `exit` or `oom` makes every input fail that way, to prove the detector end to end. Set by `packages/server/test/fuzz.test.ts`; no manual setting is needed.

| Setting | Value |
| --- | --- |
| Default | Unset |
| Accepted values | error, hang, exit or oom |
| Restart needed | No server restart; the fuzz worker reads it when it starts. |
| Explained in | [docs/environment-variables.md](../../../environment-variables.md) |
| Code | [scripts/fuzz/worker.ts:10](../../../../scripts/fuzz/worker.ts#L10) |

[All environment variables](../../../environment-variables.md)
