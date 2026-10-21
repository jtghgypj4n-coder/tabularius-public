# Serve flags

These are the options named by `tabularius help serve`. A flag takes precedence over the matching environment variable. Changes take effect when the server starts.

| Flag | Default | Accepted values | Guide |
| --- | --- | --- | --- |
| [`--accept-partial-standby`](serve/accept-partial-standby.md) | Off: a failover from an unfinished copy is refused | No value (a switch) | [docs/standby-guarantees.md](../../standby-guarantees.md) |
| [`--acme-directory`](serve/acme-directory.md) | Default ACME directory | ACME directory URL | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--ai`](serve/ai.md) | Off | Switch; present enables the assistant | [README.md](../../../README.md) |
| [`--ai-account-daily-tokens`](serve/ai-account-daily-tokens.md) | Unset | Positive number of tokens | [README.md](../../../README.md) |
| [`--ai-daily-tokens`](serve/ai-daily-tokens.md) | Unset | Positive number of tokens | [README.md](../../../README.md) |
| [`--ai-embed-model`](serve/ai-embed-model.md) | Provider default model | Embedding model id | [README.md](../../../README.md) |
| [`--ai-embed-url`](serve/ai-embed-url.md) | Embedding service off | ollama, lmstudio, or an embedding endpoint URL | [README.md](../../../README.md) |
| [`--ai-exclude`](serve/ai-exclude.md) | No excluded files | Comma-separated hosted file names | [README.md](../../../README.md) |
| [`--ai-fast-model`](serve/ai-fast-model.md) | claude-haiku-5-5 | Model id or off | [README.md](../../../README.md) |
| [`--ai-image-embed`](serve/ai-image-embed.md) | Off | voyage or jina | [docs/local-embeddings.md](../../local-embeddings.md) |
| [`--ai-image-embed-model`](serve/ai-image-embed-model.md) | Provider default model | Image embedding model id | [docs/local-embeddings.md](../../local-embeddings.md) |
| [`--ai-key-file`](serve/ai-key-file.md) | ~/.openhbam/anthropic-key | File path | [README.md](../../../README.md) |
| [`--ai-model`](serve/ai-model.md) | claude-opus-5-5 | Model id | [README.md](../../../README.md) |
| [`--ai-monthly-budget`](serve/ai-monthly-budget.md) | No monthly budget cap | Positive US dollar amount, with optional leading $ | [README.md](../../../README.md) |
| [`--ai-workspace-id`](serve/ai-workspace-id.md) | ~/.openhbam/anthropic-workspace-id if available | Workspace id | [README.md](../../../README.md) |
| [`--allow-app-connections`](serve/allow-app-connections.md) | Off | switch (present = on) | [README.md](../../../README.md) |
| [`--allow-blank-passwords`](serve/allow-blank-passwords.md) | Off | Switch; present allows blank passwords | [README.md](../../../README.md) |
| [`--allow-host`](serve/allow-host.md) | Off | switch (present = on) | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--allow-inbound-hooks`](serve/allow-inbound-hooks.md) | Off | switch (present = on) | [README.md](../../../README.md) |
| [`--allow-plain-http`](serve/allow-plain-http.md) | Off: listening beyond this computer needs HTTPS | No value (a switch) | [docs/security-defaults.md](../../security-defaults.md) |
| [`--allow-script-network`](serve/allow-script-network.md) | Off | switch (present = on) | [README.md](../../../README.md) |
| [`--allow-script-network-to`](serve/allow-script-network-to.md) | Off | switch (present = on) | [docs/moving-a-solution.md](../../moving-a-solution.md) |
| [`--allow-webhooks`](serve/allow-webhooks.md) | Off | switch (present = on) | [README.md](../../../README.md) |
| [`--backup-dir`](serve/backup-dir.md) | <folder>/Backups unless folder settings override it | Directory path | [README.md](../../../README.md) |
| [`--backup-every`](serve/backup-every.md) | 1d | off or an interval such as 1d | [README.md](../../../README.md) |
| [`--backup-s3`](serve/backup-s3.md) | Off | s3://bucket/prefix | [README.md](../../../README.md) |
| [`--capture-only`](serve/capture-only.md) | No capture-only files | Comma-separated file name prefixes | [README.md](../../../README.md) |
| [`--capture-only-copies-to-redirect`](serve/capture-only-copies-to-redirect.md) | Off | switch (present = on) | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--connections-per-address`](serve/connections-per-address.md) | 64 | Positive safe integer | [ADMIN.md](../../../ADMIN.md) |
| [`--host`](serve/host.md) | 127.0.0.1, or 0.0.0.0 with automatic HTTPS | Listen address | [README.md](../../../README.md) |
| [`--http-port`](serve/http-port.md) | 80 | Port from 0 to 65535 | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--https`](serve/https.md) | Off | local or comma-separated DNS names | [README.md](../../../README.md) |
| [`--https-email`](serve/https-email.md) | Unset | Contact email address | [README.md](../../../README.md) |
| [`--keep`](serve/keep.md) | 7 | Whole number of 1 or more | [README.md](../../../README.md) |
| [`--keep-api-tokens-on-takeover`](serve/keep-api-tokens-on-takeover.md) | Off: API tokens end when a standby takes over | No value (a switch) | [docs/standby-guarantees.md](../../standby-guarantees.md) |
| [`--ldap-base-dn`](serve/ldap-base-dn.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | [README.md](../../../README.md) |
| [`--ldap-bind-dn-template`](serve/ldap-bind-dn-template.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | [README.md](../../../README.md) |
| [`--ldap-email-attribute`](serve/ldap-email-attribute.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--ldap-group-attribute`](serve/ldap-group-attribute.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | [README.md](../../../README.md) |
| [`--ldap-name`](serve/ldap-name.md) | Hostname of the configured LDAP URL | Display name | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--ldap-search-dn`](serve/ldap-search-dn.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | [README.md](../../../README.md) |
| [`--ldap-url`](serve/ldap-url.md) | LDAP sign-in off | ldaps:// URL | [README.md](../../../README.md) |
| [`--ldap-user-attribute`](serve/ldap-user-attribute.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | [README.md](../../../README.md) |
| [`--list-files-publicly`](serve/list-files-publicly.md) | Off | Switch; present makes file names public | [README.md](../../../README.md) |
| [`--log-limit`](serve/log-limit.md) | 40MB | Byte size such as 40MB | [ADMIN.md](../../../ADMIN.md) |
| [`--mail-copies`](serve/mail-copies.md) | 20 per run | Nonnegative whole number | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--mail-from`](serve/mail-from.md) | Unset | Email address | [docs/moving-a-solution.md](../../moving-a-solution.md) |
| [`--mail-redirect`](serve/mail-redirect.md) | Unset | Email address | [docs/privacy.md](../../privacy.md) |
| [`--mcp-origin`](serve/mcp-origin.md) | No additional origins | Repeatable HTTPS origin without path | [docs/security-defaults.md](../../security-defaults.md) |
| [`--mcp-token`](serve/mcp-token.md) | unset; loopback administration only | Token string | [README.md](../../../README.md) |
| [`--mcp-token-file`](serve/mcp-token-file.md) | Unset; loopback administration only | File path (a private regular file holding the token) | [docs/environment-variables.md](../../environment-variables.md) |
| [`--no-backups`](serve/no-backups.md) | Backups on | Switch; present disables scheduled backups | [README.md](../../../README.md) |
| [`--oidc-client-id`](serve/oidc-client-id.md) | OIDC sign-in off | Client id | [README.md](../../../README.md) |
| [`--oidc-config`](serve/oidc-config.md) | Unset | JSON file path | [README.md](../../../README.md) |
| [`--oidc-data-api-return-urls`](serve/oidc-data-api-return-urls.md) | No extra return URLs | Comma-separated URLs | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--oidc-groups-claim`](serve/oidc-groups-claim.md) | Unset | Claim or display name | [README.md](../../../README.md) |
| [`--oidc-issuer`](serve/oidc-issuer.md) | OIDC sign-in off | Issuer URL | [README.md](../../../README.md) |
| [`--oidc-name`](serve/oidc-name.md) | Hostname of the configured issuer URL | Claim or display name | [README.md](../../../README.md) |
| [`--oidc-trust-email`](serve/oidc-trust-email.md) | Unset | Switch; present trusts provider email | [README.md](../../../README.md) |
| [`--open`](serve/open.md) | Off | Switch; present opens the admin welcome page | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--port`](serve/port.md) | 8080, or 443 with automatic HTTPS | Port number from 0 to 65535 | [README.md](../../../README.md) |
| [`--progressive`](serve/progressive.md) | Off | Interval such as 5m, or off | [README.md](../../../README.md) |
| [`--proxy-header`](serve/proxy-header.md) | Unset | x-forwarded-for, forwarded, or x-real-ip | [README.md](../../../README.md) |
| [`--public-url`](serve/public-url.md) | Taken from the listen address | Absolute public URL | [README.md](../../../README.md) |
| [`--replication-token`](serve/replication-token.md) | Replication off | Token of at least 16 characters | [README.md](../../../README.md) |
| [`--replication-token-file`](serve/replication-token-file.md) | Replication off | File path (a private regular file holding the token) | [docs/environment-variables.md](../../environment-variables.md) |
| [`--s3-endpoint`](serve/s3-endpoint.md) | AWS S3 endpoint | S3-compatible endpoint URL | [README.md](../../../README.md) |
| [`--s3-region`](serve/s3-region.md) | AWS_REGION or the provider default | S3 region name | [docs/reference/settings/serve-flags.md](serve-flags.md) |
| [`--send-mail`](serve/send-mail.md) | Off | Switch; present enables SMTP sending | [README.md](../../../README.md) |
| [`--sql-port`](serve/sql-port.md) | Off | Port from 0 to 65535 | [README.md](../../../README.md) |
| [`--sql-writes`](serve/sql-writes.md) | Off: the SQL connection is read-only | No value (a switch) | [docs/pgwire-writes.md](../../pgwire-writes.md) |
| [`--stats-interval`](serve/stats-interval.md) | 1m | Interval such as 1m, or off | [README.md](../../../README.md) |
| [`--test-outbound`](serve/test-outbound.md) | Off | Switch; present captures outbound effects | [docs/moving-a-solution.md](../../moving-a-solution.md) |
| [`--tls-cert`](serve/tls-cert.md) | Unset | PEM certificate file path | [README.md](../../../README.md) |
| [`--tls-key`](serve/tls-key.md) | Unset | PEM private key file path | [README.md](../../../README.md) |
| [`--trusted-proxies`](serve/trusted-proxies.md) | No trusted proxy addresses | Comma-separated IP addresses or CIDR ranges | [README.md](../../../README.md) |
| [`--workers`](serve/workers.md) | One process | Whole number from 1 to 64, or auto | [README.md](../../../README.md) |
