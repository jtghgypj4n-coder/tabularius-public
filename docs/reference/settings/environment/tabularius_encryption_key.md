# TABULARIUS_ENCRYPTION_KEY

Passphrase used to unlock encrypted hosted files. A set-but-empty or whitespace-only value refuses startup; unset it to run without encryption, or give a passphrase. Nonblank passphrases are used unchanged.

| Setting | Value |
| --- | --- |
| Default | No encryption passphrase |
| Accepted values | Nonblank passphrase for encrypted hosted files; unset for no encryption |
| Restart needed | Yes for a running server. |
| Explained in | [README.md](../../../../README.md) |
| Code | [packages/server/src/setting-values.ts:16](../../../../packages/server/src/setting-values.ts#L16) |

[All environment variables](../../../environment-variables.md)
