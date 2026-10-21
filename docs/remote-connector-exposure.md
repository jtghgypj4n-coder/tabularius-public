# Reaching a local server from claude.ai: a plan to decide on

Status: a plan only. Nothing here is set up or turned on.

The claude.ai connector (and Claude Desktop's custom connectors, which go through claude.ai) reaches Tabularius from Anthropic's servers on the internet. A server on a home or office network can't be reached that way today. This compares three ways to make it reachable, and says what each one would expose.

## What has to be public, and nothing more

The connector needs these paths and no others:

| Path | Who calls it |
|---|---|
| `/mcp` | claude.ai, with a token |
| `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` | claude.ai, to find the sign-in |
| `/.well-known/oauth-authorization-server` | claude.ai |
| `/oauth/register`, `/oauth/token`, `/oauth/revoke` | claude.ai |
| `/oauth/authorize` | your browser, wherever you are when you add the connector |

Everything else must stay off the internet: `/app/` (the web client), `/admin/`, `/fmi/` (the Data API, whose file list is hidden by default but can be enabled), OData, the SQL port, containers and the docs pages. Each option below can be limited to the paths above; that limit is the most important part of the setup.

## The three options

### Tailscale Funnel

The server keeps an outgoing connection to Tailscale, and Tailscale sends public traffic for `https://MACHINE.TAILNET.ts.net` down it. No port is opened on the router, and the home address isn't published.

- **Encryption:** the certificate lives on the server machine and TLS ends there, so Tailscale relays encrypted traffic it can't read.
- **Limiting paths:** Funnel maps one path at a time to a local address (`--set-path`). Map `/mcp`, `/oauth/` and the two `/.well-known/oauth-…` paths, and nothing else.
- **Limits:** public ports are 443, 8443 or 10000 only. The address is a `ts.net` name, not your own domain. It needs a Tailscale account, and Funnel turned on for the tailnet.
- **Cost:** free for personal use.

### Cloudflare Tunnel

The server runs `cloudflared`, which keeps an outgoing connection to Cloudflare. Cloudflare serves a hostname on a domain you have in Cloudflare (for example `mcp.tabularius.dev`).

- **Encryption:** TLS ends at Cloudflare, which decrypts every request and response before passing it on. Cloudflare would see sign-in passwords on the sign-in page, tokens, and whatever records the AI app reads.
- **Limiting paths:** ingress rules in `cloudflared`'s config can allow only the paths above, ending with a catch-all rule that answers 404.
- **What it adds:** Cloudflare's firewall and rate limiting can sit in front. Cloudflare Access can't guard `/mcp`, because claude.ai can't sign in to it, though it could guard other paths if any were ever needed.
- **Cost:** free. It needs the domain's DNS at Cloudflare.

### A reverse proxy with Let's Encrypt

A proxy such as Caddy or nginx runs on the server machine with a Let's Encrypt certificate for your own domain. The router forwards port 443 to it.

- **Encryption:** TLS ends on the server machine, and no company sits in between.
- **Exposure:** it publishes the network's address and opens a port on the router. Anything else listening behind it is one config mistake away from the internet.
- **Limiting paths:** a location allow-list for the paths above, and 404 for the rest.
- **Upkeep:** it needs a domain, DNS that follows the home address if that address changes, and certificate renewal. Caddy does renewal by itself; Tabularius's own `--https your.domain` can also do it, but then Tabularius itself faces the internet with every path.

## Risks, given what the server hosts

A server often hosts files that must never be reachable from the internet (client files, say) beside ones meant to be. Turning AI off for a file (`tabularius ai … off`) keeps it out of the connector's sign-in page and makes `/mcp` refuse it, but that protection is a setting. One mistaken `tabularius ai … on`, or a new file dropped into the folder and left with AI on, would make it reachable.

- **Safest: a second, separate server for the connector.** Run another `tabularius serve` on its own folder that holds only files meant to be reachable, on its own port, and point the tunnel at that alone. The other files are then not in the exposed process at all. **This is the recommendation, whichever option is chosen.**
- **Password guessing:** the sign-in page takes a file's account and password. Start the exposed server with `--proxy-header x-forwarded-for` (the header these three add the visitor's address to), so lockouts and "local only" rules see the visitor. Address budgets count 30 failures per IPv4 address or IPv6 /64, including recovery and TOTP failures. Each network can hold at most six live lock entries. Address counters remain protected until their window expires; account counters below the lock threshold may yield capacity, but their failures stay charged to the network. Live locks also survive table pressure. When no slot can be freed, new sources are refused before credential checks so guesses never pass through uncounted. This also refuses a new loopback account/source key with no prior counter; retained loopback keys keep working unless locked. The remaining trade-off is availability: an attacker controlling about 6,700 networks (available within one IPv6 /48) can fill the 40,000-entry table and make the server refuse **new sources** for the lock window (15 minutes by default). Existing signed-in users keep working, and correct passwords from known sources with retained address counters still work unless that account or network is itself locked.
- **Clients reported as `unknown`:** without a usable trusted proxy header, visitors share the `unknown` identity and never qualify as local. They share a bounded pool for invented account names, but have no address-wide failure lock. Filling that pool, or ordinary capacity, does not block correct passwords for provisioned accounts without their own lockout. Successful directory sign-ins remember up to 4,096 confirmed name buckets per file in memory only, including people mapped through a group without a local account row. Confirmed names have independent password counters and keep access when the invented-name pool or ordinary table fills, unless their own counter is locked. Five wrong passwords still lock a confirmed name; the local password check and LDAP fallback count as one attempt, so four wrong passwords followed by a correct directory password succeed. Success clears only that source’s password failure counter without forgetting its confirmation or lifting other sources’ locks. The cache replaces the least recently successful name without an active failure counter; active counters pin their names until cleared or expired. If every cached name is pinned, a successful new sign-in is not remembered until room becomes available. Never-seen directory names (and names forgotten by eviction or closing/reopening the file) use the shared invented-name pool: when it is full they are refused before LDAP/AD is called, even with the correct password, until capacity frees or expires. Wrong-password, lockout and capacity refusals on Data API password and passkey-2fa sign-in, SQL over HTTP (including OData and XML), and AI-app OAuth return the same ordinary wrong-password response on each surface, with no `Retry-After`, for these unidentified sources, whether the name is provisioned, confirmed, never seen or invented, with or without directory authentication. OAuth clears the typed account on a wrong-password refusal so the complete page is identical too. This deliberately gives up lockout/retry guidance for these callers so response status, headers and body cannot disclose confirmation through pool pressure. Internal admission and lockouts still apply: confirmed users with correct passwords retain access at capacity, but locked users remain locked. Failed guesses cannot add or evict confirmed names. Directory checks are single-flight per file, normalized name and source: overlapping attempts count as failures but do not each reach LDAP, and a late success cannot clear a new lock. Residual timing disclosure remains: full-pool and locked-name refusals skip password hashing and LDAP, while admitted provisioned or confirmed names perform password hashing and may contact LDAP. Response uniformity therefore does not hide account state from a caller measuring repeated timings; shared-source deployments should not rely on it for timing-resistant account privacy. Provisioned accounts retain independent counters for passwords, TOTP and recovery codes: five failures within 15 minutes lock that account and factor for 15 minutes for all `unknown` visitors. These counters use a separate reserve bounded by the provisioned accounts (at most three counters per account); invented names cannot consume it. Targeted guessing can still lock an account for other unidentified visitors, but flooding made-up names cannot consume the provisioned-account reserve. Accounts reachable this way should have strong passwords and a second factor.
- **No administrator by accident:** `/mcp` answers no one without a credential, a request from the server machine itself included, so a proxy on the same computer cannot turn a visitor into the administrator. The administrator's bearer token is the one given with `--mcp-token`, or else the one the server made on first start in `.openhbam-mcp-token` in the hosted folder. Still start the exposed server with `--public-url https://…/` and `--proxy-header x-forwarded-for`, and prefer a token made for one account over the administrator's.
- **File names:** the server's lists (`/`, the Data API's and OData's) name no file unless it was started with `--list-files-publicly`: leave that off on the exposed server. The web sign-in page and the AI app sign-in page then ask for the file's name instead of offering a list. With the lists off, a name that isn't hosted gets the same answer as one that is (the Data API's sign-in, passkey and recovery start, OData, SQL and OIDC start), at the same cost, so a guessed name is not confirmed. A server started with `--list-files-publicly` says "no such file" as before.
- **What an AI app can do once signed in:** whatever the account's privilege set allows in that one file. Give connector accounts a privilege set made for it, read-only where that's enough, with the fmmcp extended privilege.
- **Scripts:** keep `--allow-script-network` and `--allow-webhooks` off on the exposed server, so nothing an AI app triggers can send mail or reach other sites.

## Suggested order

1. Decide which files should be reachable, and make a folder holding only those.
2. Try Tailscale Funnel first: no open port, and nobody in between who can read the traffic. Map only the paths above to the second server.
3. Add the connector in claude.ai, sign in with a test account, and check that `/app/`, `/admin/` and `/fmi/` answer 404 from outside.
