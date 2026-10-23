# tabularius serve

This command's usage comes from `tabularius help serve`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius serve <folder> [--port 8080] [--host 127.0.0.1] [--open] [--mcp-token T|--mcp-token-file F] [--allow-script-network] [--allow-script-network-to hosts] [--allow-app-connections] [--allow-webhooks] [--allow-inbound-hooks]
                [--list-files-publicly]
                [--tls-cert cert.pem --tls-key key.pem] [--allow-plain-http] [--public-url URL] [--mcp-origin URL]... [--proxy-header x-forwarded-for|forwarded|x-real-ip] [--trusted-proxies IP/CIDR,...] [--connections-per-address N]
                [--https name[,name]|local [--https-email E] [--http-port 80] [--acme-directory URL]] [--sql-port 5432 [--sql-writes]]
                [--backup-every 1d] [--keep 7] [--backup-dir DIR] [--no-backups]
                [--progressive 5m] [--stats-interval 1m|off] [--log-limit 100MB] [--backup-s3 s3://bucket/prefix [--s3-endpoint URL] [--s3-region REGION]] [--replication-token T|--replication-token-file F] [--keep-api-tokens-on-takeover] [--accept-partial-standby] [--ai] [--allow-blank-passwords]
                [--oidc-issuer URL --oidc-client-id ID [--oidc-name N] [--oidc-groups-claim C] [--oidc-trust-email] [--oidc-data-api-return-urls URL,...]] [--oidc-config providers.json]
                [--ldap-url ldaps://host [--ldap-user-attribute A] [--ldap-base-dn DN] [--ldap-bind-dn-template T] [--ldap-search-dn DN] [--ldap-name N] [--ldap-email-attribute A] [--ldap-group-attribute A]]
                [--workers N|auto] [--test-outbound [--mail-redirect ADDRESS] [--mail-copies 20] [--allow-host h[,h]] [--capture-only F[,F]] [--capture-only-copies-to-redirect]]
                [--send-mail --mail-from ADDRESS [--capture-only F[,F]]]
                                             Data API at /fmi/data/vLatest, MCP at /mcp,
                                             web client at /app/. Listens on this computer
                                             only. --host 0.0.0.0 lets others on the network
                                             connect, but needs HTTPS (--https, --tls-cert)
                                             or --allow-plain-http. Backs up
                                             daily to <folder>/Backups unless told not to;
                                             --backup-s3 copies them off-site (keys in
                                             TABULARIUS_S3_ACCESS_KEY / TABULARIUS_S3_SECRET_KEY).
                                             Import Records in scripts reads files from
                                             <folder>/Documents only.
                                             --open opens the admin welcome page in a browser
                                             after a single-process server starts.
                                             --allow-inbound-hooks answers calls to the
                                             inbound hooks set up in the admin console.
                                             --https gets and renews a certificate from Let's
                                             Encrypt (the name must point here and port 80
                                             reach it); serves on 443 unless --port.
                                             --https local: a certificate from this server's own
                                             authority, for a local network; devices trust it
                                             once from /tabularius/tls/. http:// to the port is
                                             sent on to https://.
                                             --sql-port lets BI tools and PostgreSQL ODBC/JDBC
                                             drivers query files (accounts need fmxdbc).
                                             --sql-writes (with --sql-port) also lets them
                                             INSERT, UPDATE and DELETE; off by default.
                                             --ai turns on the AI assistant in the web client
                                             (key in ANTHROPIC_API_KEY, else the file
                                             ~/.openhbam/anthropic-key, chmod 600, or --ai-key-file F
                                             (read again when it changes); a key not made inside
                                             a workspace needs --ai-workspace-id wrkspc_… or the
                                             file ~/.openhbam/anthropic-workspace-id; --ai-model M
                                             for design work, default claude-opus-5-5; --ai-embed-url U --ai-embed-model M
                                             (key in TABULARIUS_AI_EMBED_KEY) for script embeddings,
                                             RAG and semantic find; U can be ollama or lmstudio
                                             (the model is then optional), and with no --ai the
                                             embedding steps work without an Anthropic key;
                                             --ai-image-embed voyage|jina [--ai-image-embed-model M] (key in
                                             TABULARIUS_AI_IMAGE_EMBED_KEY) for Perform Semantic Find
                                             by image; --ai-fast-model M for simple
                                             questions, default claude-haiku-5-5, off for one model;
                                             --ai-daily-tokens N caps tokens per day,
                                             --ai-account-daily-tokens N per account,
                                             --ai-run-tokens N for one question (default 300000, strict),
                                             --ai-monthly-budget D stops at about D US dollars a month).
                                             --ai-exclude A,B keeps those files from AI apps
                                             and the assistant entirely (also: tabularius ai ... off).
                                             --workers runs N processes (auto: one per CPU
                                             core) behind the one port, sharing record locks
                                             and live updates; not yet with --progressive,
                                             --replication-token, --https name (automatic
                                             certificates) or encryption at rest.
                                             --stats-interval sets how often Stats.log and
                                             TopCallStats.log (FileMaker Server's layout) get a
                                             line in <folder>/Logs: 1m by default, off to stop.
                                             --log-limit is how big a log may get before it is
                                             kept as <name>-old.log and started again: 40MB by
                                             default (also logLimit in the folder's settings).
                                             --test-outbound lets scripts try mail and web
                                             calls safely: every message goes to <folder>/Outbox
                                             (shown in /admin) and never to its recipients; with
                                             --mail-redirect and an SMTP account of your own in
                                             TABULARIUS_TEST_SMTP or ~/.openhbam/test-smtp
                                             (smtps://user:pass@host:465), a
                                             copy goes to that one address. Requests reach only
                                             --allow-host hosts; others get an empty answer,
                                             and a run that calls one blocked host 100 times
                                             is stopped. test-scripts lists what each script
                                             tried to reach. Mail from capture-only files
                                             (named with --capture-only F[,F], or in
                                             TABULARIUS_CAPTURE_ONLY; each name matches any file
                                             starting with it) is only kept in the outbox, not
                                             even copied to the redirect address, unless
                                             --capture-only-copies-to-redirect; never
                                             sent to anyone else. No file is capture-only
                                             unless you name it.
                                             --send-mail lets Send Mail via SMTP really send,
                                             through the SMTP account in TABULARIUS_SMTP or
                                             ~/.openhbam/smtp (smtps://user:pass@host:465),
                                             from --mail-from (the script's From name is shown,
                                             its address gets replies). Off by default. Nothing is
                                             sent while a capture-only file (--capture-only or
                                             TABULARIUS_CAPTURE_ONLY) is in the folder. Not with
                                             --test-outbound.
```

## Options

`--accept-partial-standby`, `--acme-directory`, `--ai`, `--ai-account-daily-tokens`, `--ai-daily-tokens`, `--ai-embed-model`, `--ai-embed-url`, `--ai-exclude`, `--ai-fast-model`, `--ai-image-embed`, `--ai-image-embed-model`, `--ai-key-file`, `--ai-model`, `--ai-monthly-budget`, `--ai-run-tokens`, `--ai-workspace-id`, `--allow-app-connections`, `--allow-blank-passwords`, `--allow-host`, `--allow-inbound-hooks`, `--allow-plain-http`, `--allow-script-network`, `--allow-script-network-to`, `--allow-webhooks`, `--backup-dir`, `--backup-every`, `--backup-s3`, `--capture-only`, `--capture-only-copies-to-redirect`, `--connections-per-address`, `--host`, `--http-port`, `--https`, `--https-email`, `--keep`, `--keep-api-tokens-on-takeover`, `--ldap-base-dn`, `--ldap-bind-dn-template`, `--ldap-email-attribute`, `--ldap-group-attribute`, `--ldap-name`, `--ldap-search-dn`, `--ldap-url`, `--ldap-user-attribute`, `--list-files-publicly`, `--log-limit`, `--mail-copies`, `--mail-from`, `--mail-redirect`, `--mcp-origin`, `--mcp-token`, `--mcp-token-file`, `--no-backups`, `--oidc-client-id`, `--oidc-config`, `--oidc-data-api-return-urls`, `--oidc-groups-claim`, `--oidc-issuer`, `--oidc-name`, `--oidc-trust-email`, `--open`, `--port`, `--progressive`, `--proxy-header`, `--public-url`, `--replication-token`, `--replication-token-file`, `--s3-endpoint`, `--s3-region`, `--send-mail`, `--sql-port`, `--sql-writes`, `--stats-interval`, `--test-outbound`, `--tls-cert`, `--tls-key`, `--trusted-proxies`, `--workers`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius serve --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
