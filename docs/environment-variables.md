# Environment variables

Most `tabularius serve` options can be set in the environment instead of on the
command line, which suits a service definition or a container. A command-line
flag wins over the variable. Secrets (`TABULARIUS_OIDC_CLIENT_SECRET`,
`TABULARIUS_LDAP_SEARCH_PASSWORD`, `TABULARIUS_BACKUP_KEY`, `TABULARIUS_ENCRYPTION_KEY`,
`TABULARIUS_SECRETS_KEY`, `TABULARIUS_S3_SECRET_KEY`) are read only from the
environment, never from a flag, so they stay out of process listings; they are
described where the feature is ([README](../README.md), [ADMIN](../ADMIN.md)).

The `docs:check` gate fails when code reads a `TABULARIUS_*` variable or
accepts a serve flag without a metadata entry. The existing docs drift test
also checks variable names across the documentation.

This table is generated from the notes in `scripts/reference/settings-cli-metadata.json`. Each linked page gives the setting's details and code location. See [serve flags](reference/settings/serve-flags.md) and the [command-line reference](reference/cli/index.md).

| Variable | Default | Accepted values | Restart needed | Guide |
| --- | --- | --- | --- | --- |
| [`TABULARIUS_ACME_DIRECTORY`](reference/settings/environment/tabularius_acme_directory.md) | Default ACME directory | ACME directory URL | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_ACCOUNT_DAILY_TOKENS`](reference/settings/environment/tabularius_ai_account_daily_tokens.md) | Unset | Positive number of tokens | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_DAILY_TOKENS`](reference/settings/environment/tabularius_ai_daily_tokens.md) | Unset | Positive number of tokens | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_EMBED_KEY`](reference/settings/environment/tabularius_ai_embed_key.md) | No embedding API key | API key text | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_AI_EMBED_MODEL`](reference/settings/environment/tabularius_ai_embed_model.md) | Provider default model | Embedding model id | Yes for a running server. | [docs/local-embeddings.md](local-embeddings.md) |
| [`TABULARIUS_AI_EMBED_URL`](reference/settings/environment/tabularius_ai_embed_url.md) | Embedding service off | ollama, lmstudio, or an embedding endpoint URL | Yes for a running server. | [docs/local-embeddings.md](local-embeddings.md) |
| [`TABULARIUS_AI_EXCLUDE`](reference/settings/environment/tabularius_ai_exclude.md) | No excluded files | Comma-separated hosted file names | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_FAST_MODEL`](reference/settings/environment/tabularius_ai_fast_model.md) | claude-haiku-5-5 | model id or off | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_IMAGE_EMBED`](reference/settings/environment/tabularius_ai_image_embed.md) | Image embedding off | voyage or jina | Yes for a running server. | [docs/local-embeddings.md](local-embeddings.md) |
| [`TABULARIUS_AI_IMAGE_EMBED_KEY`](reference/settings/environment/tabularius_ai_image_embed_key.md) | No image embedding API key | API key text | Yes for a running server. | [docs/local-embeddings.md](local-embeddings.md) |
| [`TABULARIUS_AI_IMAGE_EMBED_MODEL`](reference/settings/environment/tabularius_ai_image_embed_model.md) | Provider default model | Image embedding model id | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_KEY_FILE`](reference/settings/environment/tabularius_ai_key_file.md) | ~/.openhbam/anthropic-key | File path | Changing this path needs a restart; edits to the file at that path are reread. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_MODEL`](reference/settings/environment/tabularius_ai_model.md) | claude-opus-5-5 | Model id | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_MONTHLY_BUDGET`](reference/settings/environment/tabularius_ai_monthly_budget.md) | No monthly budget cap | Positive US dollar amount, with optional leading $ | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_RUN_TOKENS`](reference/settings/environment/tabularius_ai_run_tokens.md) | 300000 | Whole number of tokens, 1 to 10,000,000 | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_AI_WORKSPACE_ID`](reference/settings/environment/tabularius_ai_workspace_id.md) | ~/.openhbam/anthropic-workspace-id if available | Workspace id | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_ALIAS`](reference/settings/environment/tabularius_alias.md) | Normal tabularius command name | openhbam (legacy launcher alias) | No server restart; a new command reads it on invocation. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_ALLOW_PLAIN_HTTP`](reference/settings/environment/tabularius_allow_plain_http.md) | Off: listening beyond this computer needs HTTPS | 1, true, yes or on | Yes for a running server. | [docs/security-defaults.md](security-defaults.md) |
| [`TABULARIUS_BACKUP_DIR`](reference/settings/environment/tabularius_backup_dir.md) | <folder>/Backups unless folder settings override it | Directory path | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_BACKUP_EVERY`](reference/settings/environment/tabularius_backup_every.md) | 1d | interval such as 1d | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_BACKUP_KEEP`](reference/settings/environment/tabularius_backup_keep.md) | 7 | Whole number of 1 or more | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_BACKUP_KEY`](reference/settings/environment/tabularius_backup_key.md) | No backup encryption passphrase | Nonempty passphrase | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_BACKUP_S3`](reference/settings/environment/tabularius_backup_s3.md) | Off | s3://bucket/prefix | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_CAPTURE_ONLY`](reference/settings/environment/tabularius_capture_only.md) | No capture-only files | Comma-separated file name prefixes | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_CHROMIUM`](reference/settings/environment/tabularius_chromium.md) | Auto-discovered browser for tests | Path to a Chromium executable | No server restart; a new command reads it on invocation. | [README.md](../README.md) |
| [`TABULARIUS_CONNECTIONS_PER_ADDRESS`](reference/settings/environment/tabularius_connections_per_address.md) | 64 | positive safe integer | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_CONTAINER_TTL`](reference/settings/environment/tabularius_container_ttl.md) | 3600 seconds | Positive seconds up to 3600, which is also what any other value (0, negative, not a number, longer) gives; a link signed for more than an hour ahead is refused | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_CONVERT_MEMORY`](reference/settings/environment/tabularius_convert_memory.md) | 2048 MB | Nonnegative number of MB; 0 disables the limit | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_CONVERT_TIMEOUT`](reference/settings/environment/tabularius_convert_timeout.md) | 900 seconds | Nonnegative number of seconds; 0 disables the limit | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_COUNT_SQL`](reference/settings/environment/tabularius_count_sql.md) | Off | 1 | No server restart; read when a store is opened. | [docs/performance.md](performance.md) |
| [`TABULARIUS_DATA_API_MAX_LIMIT`](reference/settings/environment/tabularius_data_api_max_limit.md) | 10000 records | Nonnegative whole number; 0 removes the cap | Yes; restart the server after changing its environment. | [docs/data-api-compatibility.md](data-api-compatibility.md) |
| [`TABULARIUS_DRAIN_SECONDS`](reference/settings/environment/tabularius_drain_seconds.md) | 20 seconds | 1 to 86400 | Yes for a running server. | [docs/upgrading.md](upgrading.md) |
| [`TABULARIUS_ENCRYPTION_KEY`](reference/settings/environment/tabularius_encryption_key.md) | No encryption passphrase | Passphrase for encrypted hosted files | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_FIXTURE_CACHE`](reference/settings/environment/tabularius_fixture_cache.md) | ~/.cache/tabularius-fixtures | Directory path | No server restart; a new command reads it on invocation. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_FMS_KEY_PASSPHRASE`](reference/settings/environment/tabularius_fms_key_passphrase.md) | Prompt if needed | Passphrase text | No server restart; a new command reads it on invocation. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_FMS_PASSWORD`](reference/settings/environment/tabularius_fms_password.md) | Prompt if needed | Password text | Yes for a running server; new CLI invocations read the changed value. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_FOLDER`](reference/settings/environment/tabularius_folder.md) | ~/tabularius | Folder path | No server restart; a new command reads it on invocation. | [docs/moving-a-solution.md](moving-a-solution.md) |
| [`TABULARIUS_FUZZ_SELFTEST`](reference/settings/environment/tabularius_fuzz_selftest.md) | Unset | error, hang, exit or oom | No server restart; the fuzz worker reads it when it starts. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_HOME`](reference/settings/environment/tabularius_home.md) | ~/.openhbam | file or directory path | Yes for a running server; new CLI invocations read the changed value. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_HOST`](reference/settings/environment/tabularius_host.md) | 127.0.0.1 (0.0.0.0 with automatic HTTPS) | IP address or hostname | Yes for a running server. | [docs/security-defaults.md](security-defaults.md) |
| [`TABULARIUS_HTTP_PORT`](reference/settings/environment/tabularius_http_port.md) | 80 | Port number | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_HTTPS`](reference/settings/environment/tabularius_https.md) | Off | local, lan, or comma-separated DNS names | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_HTTPS_EMAIL`](reference/settings/environment/tabularius_https_email.md) | Unset | Contact email address | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LDAP_BASE_DN`](reference/settings/environment/tabularius_ldap_base_dn.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LDAP_BIND_DN_TEMPLATE`](reference/settings/environment/tabularius_ldap_bind_dn_template.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LDAP_EMAIL_ATTRIBUTE`](reference/settings/environment/tabularius_ldap_email_attribute.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LDAP_GROUP_ATTRIBUTE`](reference/settings/environment/tabularius_ldap_group_attribute.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LDAP_NAME`](reference/settings/environment/tabularius_ldap_name.md) | Hostname of the configured LDAP URL | Display name | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LDAP_SEARCH_DN`](reference/settings/environment/tabularius_ldap_search_dn.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LDAP_SEARCH_PASSWORD`](reference/settings/environment/tabularius_ldap_search_password.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_LDAP_URL`](reference/settings/environment/tabularius_ldap_url.md) | LDAP sign-in off | ldaps:// URL | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LDAP_USER_ATTRIBUTE`](reference/settings/environment/tabularius_ldap_user_attribute.md) | Unset | LDAP distinguished name, template, attribute, or password as named by the variable | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_LIST_FILES_PUBLICLY`](reference/settings/environment/tabularius_list_files_publicly.md) | off | 1, true, yes, or on | Yes for a running server. | [docs/data-api-compatibility.md](data-api-compatibility.md) |
| [`TABULARIUS_LOG_LIMIT`](reference/settings/environment/tabularius_log_limit.md) | 40MB | Byte size such as 40MB | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_MAX_SESSION_LOCKS`](reference/settings/environment/tabularius_max_session_locks.md) | 100000 | Positive safe integer | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_MAX_SESSIONS_PER_ACCOUNT`](reference/settings/environment/tabularius_max_sessions_per_account.md) | 100 sessions | Nonnegative whole number; 0 removes the cap | Yes; restart the server after changing its environment. | [docs/data-api-compatibility.md](data-api-compatibility.md) |
| [`TABULARIUS_MAX_UPLOAD`](reference/settings/environment/tabularius_max_upload.md) | 10 GiB | Nonnegative bytes; 0 removes the per-file cap | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_MAX_UPLOAD_IN_PROGRESS`](reference/settings/environment/tabularius_max_upload_in_progress.md) | 20 GiB | Positive bytes | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_MCP_ORIGINS`](reference/settings/environment/tabularius_mcp_origins.md) | No additional browser origins | Comma-separated HTTPS origins without paths | Yes for a running server. | [docs/security-defaults.md](security-defaults.md) |
| [`TABULARIUS_MCP_TOKEN`](reference/settings/environment/tabularius_mcp_token.md) | Unset; loopback administration only | Token string | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_MCP_TOKEN_FILE`](reference/settings/environment/tabularius_mcp_token_file.md) | Unset; loopback administration only | File path (the file must not be readable by other users) | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_MIN_PASSWORD_LENGTH`](reference/settings/environment/tabularius_min_password_length.md) | 12 | Whole number from 0 to 999 (0 for no minimum) | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_OIDC_CLIENT_ID`](reference/settings/environment/tabularius_oidc_client_id.md) | OIDC sign-in off | Client id | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_OIDC_CLIENT_SECRET`](reference/settings/environment/tabularius_oidc_client_secret.md) | Unset | Client secret text | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_OIDC_CONFIG`](reference/settings/environment/tabularius_oidc_config.md) | Unset | JSON file path | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_OIDC_DATA_API_RETURN_URLS`](reference/settings/environment/tabularius_oidc_data_api_return_urls.md) | No extra return URLs | Comma-separated URLs | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_OIDC_GROUPS_CLAIM`](reference/settings/environment/tabularius_oidc_groups_claim.md) | Unset | Claim or display name | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_OIDC_ISSUER`](reference/settings/environment/tabularius_oidc_issuer.md) | OIDC sign-in off | Issuer URL | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_OIDC_NAME`](reference/settings/environment/tabularius_oidc_name.md) | Hostname of the configured issuer URL | Claim or display name | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_OIDC_TRUST_EMAIL`](reference/settings/environment/tabularius_oidc_trust_email.md) | Off | 1, true, or yes | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_OUTBOUND_MAX_TIME_MS`](reference/settings/environment/tabularius_outbound_max_time_ms.md) | 600000 ms | Positive milliseconds | Yes; restart the server after changing its environment. | [docs/outbound-requests.md](outbound-requests.md) |
| [`TABULARIUS_PASSWORD`](reference/settings/environment/tabularius_password.md) | Prompt if needed | Password text | No server restart; a new command reads it on invocation. | [README.md](../README.md) |
| [`TABULARIUS_PGWIRE_MAX_BUFFERED_ROWS`](reference/settings/environment/tabularius_pgwire_max_buffered_rows.md) | 100000 | Positive whole number of rows | Yes; restart the server after changing its environment. | [docs/pgwire-results.md](pgwire-results.md) |
| [`TABULARIUS_PGWIRE_MAX_ROWS`](reference/settings/environment/tabularius_pgwire_max_rows.md) | 100000 | Nonnegative whole number of rows; 0 removes the cap | Yes; restart the server after changing its environment. | [README.md](../README.md) |
| [`TABULARIUS_PGWIRE_TX_IDLE_MS`](reference/settings/environment/tabularius_pgwire_tx_idle_ms.md) | 30000 | Nonnegative whole number of milliseconds; 0 for no limit | No server restart; read when a SQL connection begins a transaction. | [docs/pgwire-writes.md](pgwire-writes.md) |
| [`TABULARIUS_PGWIRE_TX_MAX_MS`](reference/settings/environment/tabularius_pgwire_tx_max_ms.md) | 300000 | Nonnegative whole number of milliseconds; 0 for no limit | No server restart; read when a SQL connection begins a transaction. | [docs/pgwire-writes.md](pgwire-writes.md) |
| [`TABULARIUS_PRIMARY`](reference/settings/environment/tabularius_primary.md) | No primary server | Primary server URL | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_PROGRESSIVE`](reference/settings/environment/tabularius_progressive.md) | Off | off or an interval such as 5m | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_PROXY_HEADER`](reference/settings/environment/tabularius_proxy_header.md) | No proxy header trusted | x-forwarded-for, forwarded, or x-real-ip | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_PUBLIC_URL`](reference/settings/environment/tabularius_public_url.md) | Taken from the listen address | Absolute public URL | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_REPLICATION_TOKEN`](reference/settings/environment/tabularius_replication_token.md) | Replication off | Token of at least 16 characters | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_REPLICATION_TOKEN_FILE`](reference/settings/environment/tabularius_replication_token_file.md) | Replication off | File path (the file must not be readable by other users) | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_REQUEST_BUDGET_MS`](reference/settings/environment/tabularius_request_budget_ms.md) | 60000 ms | Nonnegative milliseconds; 0 removes the budget | Yes for a running server. | [docs/runbook.md](runbook.md) |
| [`TABULARIUS_REQUEST_LIMIT`](reference/settings/environment/tabularius_request_limit.md) | 32 | Whole number of 4 or more | Yes for a running server. | [docs/performance.md](performance.md) |
| [`TABULARIUS_REQUEST_QUEUE`](reference/settings/environment/tabularius_request_queue.md) | 64 | Whole number of 0 or more | Yes for a running server. | [docs/performance.md](performance.md) |
| [`TABULARIUS_S3_ACCESS_KEY`](reference/settings/environment/tabularius_s3_access_key.md) | AWS_ACCESS_KEY_ID if set | Access key id | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_S3_ENDPOINT`](reference/settings/environment/tabularius_s3_endpoint.md) | AWS S3 endpoint | S3-compatible endpoint URL | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_S3_REGION`](reference/settings/environment/tabularius_s3_region.md) | AWS_REGION if set | Region name | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_S3_SECRET_KEY`](reference/settings/environment/tabularius_s3_secret_key.md) | AWS_SECRET_ACCESS_KEY if set | Secret access key | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_SECRETS_KEY`](reference/settings/environment/tabularius_secrets_key.md) | TABULARIUS_ENCRYPTION_KEY if set | Passphrase text | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_SHARE_RESULTS`](reference/settings/environment/tabularius_share_results.md) | Enabled when result sharing is configured and the file is not encrypted | 0 disables sharing | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_SMTP`](reference/settings/environment/tabularius_smtp.md) | SMTP_FILE contents if present | smtps:// URL | Yes for a running server. | [docs/privacy.md](privacy.md) |
| [`TABULARIUS_SMTP_FILE`](reference/settings/environment/tabularius_smtp_file.md) | ~/.openhbam/smtp | file or directory path | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_SOURCE_PASSPHRASE`](reference/settings/environment/tabularius_source_passphrase.md) | Prompt if needed | Passphrase text | No server restart; a new command reads it on invocation. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_SQL_PORT`](reference/settings/environment/tabularius_sql_port.md) | SQL listener off | Port number from 0 to 65535 | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_SQL_WRITES`](reference/settings/environment/tabularius_sql_writes.md) | Off: the SQL connection is read-only | 1, true, yes or on | Yes for a running server. | [docs/pgwire-writes.md](pgwire-writes.md) |
| [`TABULARIUS_STATS_INTERVAL`](reference/settings/environment/tabularius_stats_interval.md) | 1m | interval such as 1m, or off | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_STOP_GRACE_MS`](reference/settings/environment/tabularius_stop_grace_ms.md) | 30000 ms | Nonnegative milliseconds | Yes for a running server. | [docs/service-files.md](service-files.md) |
| [`TABULARIUS_SYNC_HOSTS`](reference/settings/environment/tabularius_sync_hosts.md) | No fixed allowlist | Comma-separated host or host:port entries | Yes; restart the server after changing its environment. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_SYNC_SECRETS`](reference/settings/environment/tabularius_sync_secrets.md) | <hosted folder>/.openhbam-secrets | Directory path | Yes; restart the server after changing its environment. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_TEST_CHILD_MARKER`](reference/settings/environment/tabularius_test_child_marker.md) | Unset | Temporary marker file path | No server restart; a new command reads it on invocation. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_TEST_SMTP`](reference/settings/environment/tabularius_test_smtp.md) | TEST_SMTP_FILE contents if present | smtps:// URL | Yes for a running server. | [docs/privacy.md](privacy.md) |
| [`TABULARIUS_TEST_SMTP_FILE`](reference/settings/environment/tabularius_test_smtp_file.md) | ~/.openhbam/test-smtp | file or directory path | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_THUMBNAILS`](reference/settings/environment/tabularius_thumbnails.md) | System tools when available | builtin to disable system tools | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_TOKEN_DEFAULT_DAYS`](reference/settings/environment/tabularius_token_default_days.md) | 90 days | Whole or decimal number of days up to 3650; 0 for tokens that never expire | No server restart; read when a token is made. | [docs/security-defaults.md](security-defaults.md) |
| [`TABULARIUS_TRACE_SQL`](reference/settings/environment/tabularius_trace_sql.md) | Off | Any nonempty value except 0 enables tracing | Yes; restart the server after changing its environment. | [docs/performance.md](performance.md) |
| [`TABULARIUS_TRACE_SQL_MIN_MS`](reference/settings/environment/tabularius_trace_sql_min_ms.md) | 0 ms | Nonnegative milliseconds | Yes; restart the server after changing its environment. | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_TRUSTED_PROXIES`](reference/settings/environment/tabularius_trusted_proxies.md) | No trusted proxy addresses | Comma-separated IP addresses or CIDR ranges | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_UPLOAD_IDLE_HOURS`](reference/settings/environment/tabularius_upload_idle_hours.md) | 24 hours | nonnegative number; 0 keeps uploads until restart | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_UPLOAD_TMP`](reference/settings/environment/tabularius_upload_tmp.md) | System temporary directory | Directory path | Yes for a running server. | [README.md](../README.md) |
| [`TABULARIUS_VISUAL_UPDATE`](reference/settings/environment/tabularius_visual_update.md) | Unset | 1 (set by the test command) | Not applicable | [docs/environment-variables.md](environment-variables.md) |
| [`TABULARIUS_WARM_HEAP_MB`](reference/settings/environment/tabularius_warm_heap_mb.md) | 1536 MB | Number of MB; minimum 256 | Yes for a running server. | [ADMIN.md](../ADMIN.md) |
| [`TABULARIUS_WORKERS`](reference/settings/environment/tabularius_workers.md) | one process | auto or a positive whole number | Yes for a running server. | [docs/environment-variables.md](environment-variables.md) |

## Names that appear in the documentation but are not read by the server

- `TABULARIUS_AUTH` is the name an example in [Connect an AI app](connect-ai.md)
  gives to the client-side variable holding the bearer token; it belongs to the
  MCP client's configuration.
