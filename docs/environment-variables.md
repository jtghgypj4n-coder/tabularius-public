# Environment variables

Most `tabularius serve` options can be set in the environment instead of on the
command line, which suits a service definition or a container. A command-line
flag wins over the variable. Secrets (`TABULARIUS_OIDC_CLIENT_SECRET`,
`TABULARIUS_LDAP_SEARCH_PASSWORD`, `TABULARIUS_BACKUP_KEY`, `TABULARIUS_ENCRYPTION_KEY`,
`TABULARIUS_SECRETS_KEY`, `TABULARIUS_S3_SECRET_KEY`) are read only from the
environment, never from a flag, so they stay out of process listings; they are
described where the feature is ([README](../README.md), [ADMIN](../ADMIN.md)).

A test (`packages/cli/test/docs-drift.test.ts`) fails when the code reads an
`TABULARIUS_*` variable that no page documents, or a page documents one that
nothing reads, so this list and the code cannot drift apart.

## Hosting and network

| Variable | Same as | What it sets |
| --- | --- | --- |
| `TABULARIUS_HOST` | `--host` | The address to listen on (`127.0.0.1` by default; `0.0.0.0` with `--https name`). Beyond this computer it needs HTTPS or `TABULARIUS_ALLOW_PLAIN_HTTP`. |
| `TABULARIUS_ALLOW_PLAIN_HTTP` | `--allow-plain-http` | Lets the server listen beyond this computer over plain HTTP, which it otherwise refuses to do (a proxy or network you control does the HTTPS). Set in the Docker image. |
| `TABULARIUS_HTTPS` | `--https` | `name[,name]` for a Let's Encrypt certificate, or `local` for this server's own authority. |
| `TABULARIUS_HTTPS_EMAIL` | `--https-email` | The contact address given to Let's Encrypt. |
| `TABULARIUS_HTTP_PORT` | `--http-port` | The port that answers the certificate challenge and redirects to https (80 by default). |
| `TABULARIUS_ACME_DIRECTORY` | `--acme-directory` | A different certificate authority's directory address, for testing. |
| `TABULARIUS_PROXY_HEADER` | `--proxy-header` | The header a trusted proxy puts the client address in. |
| `TABULARIUS_SQL_PORT` | `--sql-port` | The port for the PostgreSQL-compatible SQL connection. |
| `TABULARIUS_WORKERS` | `--workers` | The number of worker processes, or `auto` for one per CPU core. |
| `TABULARIUS_PROGRESSIVE` | `--progressive` | How often changes are saved as a point you can restore to with `tabularius restore --at`; `off` for never. |
| `TABULARIUS_HOME` | | The folder holding per-user settings (`~/.openhbam` by default): the AI key file, and the service definition's files. |
| `TABULARIUS_STOP_GRACE_MS` | | How long `tabularius service stop` waits for the server to finish before it ends it (30000 by default). |
| `TABULARIUS_DRAIN_SECONDS` | | How long a stopping server lets requests that are already running finish before it closes them (1 to 86400, 20 by default; see [Upgrading](upgrading.md), "Stopping and restarting"). |
| `TABULARIUS_UPLOAD_TMP` | | The folder files wait in while they arrive in a container upload (the system's temporary folder by default). It needs room for the biggest files being uploaded at once. |
| `TABULARIUS_UPLOAD_IDLE_HOURS` | | How many hours an upload in pieces (`container-uploads`) may receive nothing before it is dropped (24 by default; `0` keeps them until the server restarts). |

## Backups and replication

| Variable | Same as | What it sets |
| --- | --- | --- |
| `TABULARIUS_BACKUP_EVERY` | `--backup-every` | How often a backup is made (`1d` by default). |
| `TABULARIUS_BACKUP_KEEP` | `--keep` | How many backups to keep (7 by default). |
| `TABULARIUS_BACKUP_DIR` | `--backup-dir` | Where backups go, instead of `<folder>/Backups`. |
| `TABULARIUS_BACKUP_S3` | `--backup-s3` | A `s3://bucket/prefix` address that backups are also copied to. |
| `TABULARIUS_S3_ENDPOINT` | `--s3-endpoint` | An S3-compatible service's address, for other providers than Amazon. |
| `TABULARIUS_S3_REGION` | `--s3-region` | The bucket's region (`AWS_REGION` is used when this is not set). |
| `TABULARIUS_REPLICATION_TOKEN` | `--replication-token`, `--token` | The token a standby presents to the primary. |
| `TABULARIUS_PRIMARY` | `--primary` | The primary server a `standby` follows. |

## Sign-in providers

| Variable | Same as | What it sets |
| --- | --- | --- |
| `TABULARIUS_OIDC_ISSUER` | `--oidc-issuer` | The OpenID Connect provider's issuer address. |
| `TABULARIUS_OIDC_CLIENT_ID` | `--oidc-client-id` | The client id registered with the provider. |
| `TABULARIUS_OIDC_NAME` | `--oidc-name` | The name shown on the sign-in button. |
| `TABULARIUS_OIDC_GROUPS_CLAIM` | `--oidc-groups-claim` | The claim that lists the person's groups. |
| `TABULARIUS_OIDC_TRUST_EMAIL` | `--oidc-trust-email` | `1`, `true` or `yes` to accept the provider's email address as the account name. |
| `TABULARIUS_OIDC_DATA_API_RETURN_URLS` | `--oidc-data-api-return-urls` | Comma-separated addresses the Data API sign-in may return to. |
| `TABULARIUS_OIDC_CONFIG` | `--oidc-config` | A JSON file describing several providers. |
| `TABULARIUS_LDAP_URL` | `--ldap-url` | The directory server's `ldaps://` address. |
| `TABULARIUS_LDAP_NAME` | `--ldap-name` | The name shown for the directory. |
| `TABULARIUS_LDAP_BASE_DN` | `--ldap-base-dn` | Where in the directory people are looked up. |
| `TABULARIUS_LDAP_BIND_DN_TEMPLATE` | `--ldap-bind-dn-template` | The distinguished name a person signs in as, with the user name filled in. |
| `TABULARIUS_LDAP_SEARCH_DN` | `--ldap-search-dn` | The account used to find a person before they sign in. |
| `TABULARIUS_LDAP_USER_ATTRIBUTE` | `--ldap-user-attribute` | The attribute holding the user name. |
| `TABULARIUS_LDAP_EMAIL_ATTRIBUTE` | `--ldap-email-attribute` | The attribute holding the email address. |
| `TABULARIUS_LDAP_GROUP_ATTRIBUTE` | `--ldap-group-attribute` | The attribute listing the person's groups. |
| `TABULARIUS_TOKEN_DEFAULT_DAYS` | | Days a new API token or AI-app token lives when no lifetime is asked for (90 by default; `0` for none). A calendar feed address gets a year. Asking for `--expires-days 0` still makes a token that never expires. |

## The AI assistant

| Variable | Same as | What it sets |
| --- | --- | --- |
| `TABULARIUS_AI_KEY_FILE` | `--ai-key-file` | A file holding the Anthropic key, read again when it changes. |
| `TABULARIUS_AI_WORKSPACE_ID` | `--ai-workspace-id` | The workspace id for a key not made inside a workspace. |
| `TABULARIUS_AI_MODEL` | `--ai-model` | The model used for design work. |
| `TABULARIUS_AI_FAST_MODEL` | `--ai-fast-model` | The model used for simple questions. |
| `TABULARIUS_AI_DAILY_TOKENS` | `--ai-daily-tokens` | A cap on tokens per day. |
| `TABULARIUS_AI_ACCOUNT_DAILY_TOKENS` | `--ai-account-daily-tokens` | A cap on tokens per account per day. |
| `TABULARIUS_AI_MONTHLY_BUDGET` | `--ai-monthly-budget` | A stop at about this many US dollars a month. |
| `TABULARIUS_AI_EXCLUDE` | `--ai-exclude` | Comma-separated files kept from the assistant and AI apps entirely. |
| `TABULARIUS_AI_IMAGE_EMBED` | `--ai-image-embed` | `voyage` or `jina`, the service that embeds images for Perform Semantic Find by image (its key is `TABULARIUS_AI_IMAGE_EMBED_KEY`). |
| `TABULARIUS_AI_IMAGE_EMBED_MODEL` | `--ai-image-embed-model` | The model used for Perform Semantic Find by image. |

## Mail while testing and sending

| Variable | Same as | What it sets |
| --- | --- | --- |
| `TABULARIUS_SMTP_FILE` | | A file holding the SMTP account for `--send-mail` (`~/.openhbam/smtp` by default); `TABULARIUS_SMTP` holds it directly. |
| `TABULARIUS_TEST_SMTP` | | The SMTP account (`smtps://user:pass@host:465`) that `--test-outbound --mail-redirect` sends its one copy through. |
| `TABULARIUS_TEST_SMTP_FILE` | | A file holding that account (`~/.openhbam/test-smtp` by default). |

## Diagnostics and development

| Variable | What it sets |
| --- | --- |
| `TABULARIUS_TRACE_SQL_MIN_MS` | With `TABULARIUS_TRACE_SQL` set, logs only statements that took this many milliseconds or more. |
| `TABULARIUS_FIXTURE_CACHE` | Where `npm run fixtures` keeps downloaded fixture files between checkouts (`~/.cache/tabularius-fixtures` by default). |
| `TABULARIUS_TEST_CHILD_MARKER` | Internal to `scripts/test-cross-file-isolation.ts`: the runner sets a temporary marker path for its forbidden-command stubs. A stub writes the marker if invoked, causing the audit to fail. No manual setting is needed. |
| `TABULARIUS_VISUAL_UPDATE` | Internal to `npm run test:visual -- --update`: tells the visual regression test to write changed screenshot baselines. No manual setting is needed. |
| `TABULARIUS_FUZZ_SELFTEST` | Internal to the fuzz harness (`scripts/fuzz/worker.ts`): `error`, `hang`, `exit` or `oom` makes every input fail that way, to prove the detector end to end. Set by `packages/server/test/fuzz.test.ts`; no manual setting is needed. |

## Names that appear in the documentation but are not read by the server

- `TABULARIUS_AUTH` is the name an example in [Connect an AI app](connect-ai.md)
  gives to the client-side variable holding the bearer token; it belongs to the
  MCP client's configuration.
