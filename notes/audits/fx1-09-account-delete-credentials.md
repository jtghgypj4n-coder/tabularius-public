# AR-store-core-01: account lifecycle review follow-up

Account deletion removes automation and digest run histories before their
definitions, within the existing security transaction. Both optional history
tables are checked before use. Ownership matching remains case-insensitive.

The saved execution lifecycle regression covers multiple definitions and runs,
saved digest data and highlights, audit-failure rollback, unrelated owners,
account name reuse, and databases without the optional history tables. The
extended regression failed before the repair and passed afterward. Existing
tests remain enabled.

The lifecycle audit deliberately retains sign-in failure and lockout counters
(keyed by `lockoutName`) and `_fm_account_import_limits`. These are penalties
and rate limits, not credentials; recreating an account does not reset them.

## Reproducible validation

These commands cover the change.

```sh
npm run typecheck

node --test --test-concurrency=2 \
  packages/store/test/account-credential-lifecycle.test.ts \
  packages/server/test/account-credential-lifecycle.test.ts

node --test --test-concurrency=2 \
  packages/store/test/account-delete-pii.test.ts \
  packages/store/test/account-status.test.ts \
  packages/store/test/external-account.test.ts \
  packages/store/test/agent-accounts.test.ts \
  packages/store/test/passkeys.test.ts \
  packages/store/test/totp.test.ts \
  packages/store/test/security-audit.test.ts \
  packages/store/test/security-events.test.ts \
  packages/server/test/agent-accounts.test.ts \
  packages/server/test/session-account-cleanup.test.ts \
  packages/server/test/security.test.ts \
  packages/server/test/oauth.test.ts \
  packages/server/test/oauth-oidc.test.ts \
  packages/server/test/scim.test.ts \
  packages/server/test/automations.test.ts \
  packages/server/test/automation-deletes.test.ts \
  packages/server/test/automation-run-reliability.test.ts \
  packages/server/test/digests.test.ts \
  packages/server/test/restore-credentials.test.ts
```
