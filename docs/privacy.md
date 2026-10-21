# Privacy: what leaves your computer

**Nothing, unless you turn something on.** Tabularius has no telemetry, no analytics, no crash reports, no update check and no licence check. It does not ask for fonts, scripts, styles or pictures from anyone else's server: every page, in the web client, the admin console and the docs, loads only from the server it came from. A server started with no options connects to nothing but this computer.

## How this is checked

Three tests run on every change, and fail if this stops being true:

- `packages/server/test/no-phone-home.test.ts` starts the real program with every attempt to reach another address recorded and refused (a TCP connection, a UDP packet, a DNS question about another name). It starts a server with no options and a file to convert, uses the web pages, the Data API, OData and `/mcp`, lets it sit idle and stops it, and runs `backup`, `verify-backup`, `restore`, `doctor` and `version`. Each makes no attempt. The same recorder is shown to catch a call when one is asked for: with `--ai` and a key, it sees the AI provider being reached.
- The same test runs `tabularius demo` (the one-command trial, which hosts a starter app for this computer only) under the same recording and asserts it makes no outbound connection either.
- The same file scans every page and file the server serves (the web client's modules, the admin console, the docs) for a font, script, style, picture or frame loaded from another address, and scans the source for every address the program names. A new address fails the scan until it is listed here or marked as a name that is never connected to.
- `packages/web/e2e/no-phone-home.e2e.ts` drives a real browser through the web client, the admin console and the docs, and asserts that every request it makes is to the server it came from.

What these do not cover: the operating system, Node.js and your browser make their own connections (an update check, say), and so can a proxy or antivirus in between. They are not Tabularius's, and this page cannot speak for them.

## What you can turn on, and what it sends

Each of these is off until an administrator turns it on. When one is on, this is what it sends, to whom and when. Where the destination is typed in by an administrator, the address is theirs; [Outbound requests](outbound-requests.md) says what the server refuses to connect to even then.

| What | Turn on with | Sent to | What is sent | When |
| --- | --- | --- | --- | --- |
| AI assistant | `--ai` and a key | `api.anthropic.com` (or the address an administrator gives) | The questions people ask, and the records and design the assistant reads to answer them, as that person's account may see them (less, with [personal data isolation](personal-data-isolation.md)). To check the key works, a request for the list of models carrying the key and no data, at most every five minutes while the admin console is open, and sooner after a failure | When someone uses it; the key check while the console is open |
| AI apps over MCP | A person connects one to `/mcp` | The AI app that person connected | What it asks for, as that person's account may see it | When it asks. Tabularius sends nothing to it unprompted ([connect-ai.md](connect-ai.md)) |
| Embedding endpoint | `--ai-embed-url` | The address an administrator gives (`ollama` and `lmstudio` mean a model on this computer) | The text of the records being indexed or searched | When a script runs a semantic step ([local embeddings](local-embeddings.md)) |
| Image embedding | `--ai-image-embed voyage` or `jina`, and a key | `api.voyageai.com` or `api.jina.ai` | The picture a script passes to Perform Semantic Find, as base64, with the key | When a script runs it |
| HTTPS from Let's Encrypt | `--https <domain>` | `acme-v02.api.letsencrypt.org` (`--acme-directory` names another authority, such as the staging one `acme-staging-v02.api.letsencrypt.org`) | The domain names, a key made for the account, and an email address if `--https-email` is given. Let's Encrypt then connects in to port 80 to check you control the name | When a certificate is made or renewed |
| Scripts that reach the network | The file's **Script network** switch in the admin console (off until turned on), or `--allow-script-network` for every file | Whatever address the script uses (Insert from URL, plug-in web requests) | What the script puts in the request: address, headers, body | When a script runs it. Never for scripts an AI app runs; link-local and metadata addresses are always refused |
| Connections (Google Drive, Dropbox, Microsoft, any REST service) | `--allow-app-connections`, then an administrator sets one up | `www.googleapis.com`, `oauth2.googleapis.com`, `api.dropboxapi.com`, `content.dropboxapi.com`, `graph.microsoft.com`, `login.microsoftonline.com`, or the address given | What the script sends, and the refresh token or key to sign in | When a script uses the connection |
| Outbound test mode | `--test-outbound` | Nowhere: mail and requests are captured. With `--mail-redirect`, one copy of each mail goes to that address through the SMTP account in `TABULARIUS_TEST_SMTP` | The captured mail | When a script sends mail |
| Send Mail | `--send-mail` | The mail server an administrator gives (`TABULARIUS_SMTP`) | The message a script builds | When a script sends mail |
| Webhooks | `--allow-webhooks`, then an administrator adds one | The address typed in | A notice of each record change in the file the webhook watches | When a record changes |
| Inbound hooks | `--allow-inbound-hooks` | Nothing leaves: other programs call in with a secret | n/a | n/a |
| Single sign-on | `--oidc-issuer` (or `--oidc-config`) | The identity provider an administrator names | The sign-in exchange (client id, the code) and the fetching of its keys | When someone signs in |
| LDAP sign-in | `--ldap-url` | The directory an administrator names | The account name and password being checked, and the search | When someone signs in |
| Off-site backups | `--backup-s3` | The bucket an administrator names (`--s3-endpoint`) | The backup files (encrypted if `TABULARIUS_BACKUP_KEY` is set) | When a backup finishes |
| Following a primary server | `tabularius standby --primary` | The primary server given | A request for the files and changes, with the token | While it runs |
| Being followed | `--replication-token` | Standby servers connect in | The files and changes | When a standby asks |
| FileMaker Server sync and migration | The `migrate-fms`, `sync-plan` and `sync-apply` commands | The FileMaker Server an administrator names | Sign-in, and the records or files being exchanged | Only while the command runs |

Nothing else opens a connection. The tests check it: a raw connection outside the shared guard (`outbound-guard-drift.test.ts`) or an address not listed on this page (`no-phone-home.test.ts`) fails them.

## Commands you run that download

These run when you run them, never by themselves:

- **Installing** (`scripts/install.sh`, `scripts/install.ps1`) downloads Tabularius from its repository on GitHub and, if you do not have a recent Node, Node from `nodejs.org`.
- **`tabularius upgrade`** runs `git pull` in the installed checkout, which asks the repository it was installed from. `tabularius upgrade --from <bundle, tarball or folder>` uses a copy you already have and needs no network. Nothing checks in the background whether a new version exists.
- **`npm install`**, when you build from source, downloads packages, and `npm run fixtures` downloads sample files for the tests. The server does neither.

## Links

The docs and admin pages contain links to other sites (Claris's help, GitHub). Clicking one opens that site in your browser, as any link does; the page itself loads nothing from it.

## If this becomes untrue

A connection that Tabularius makes and this page does not list is a bug: open an issue. The tests above are meant to fail before it ships, and they can have missed something.
