# Outbound requests

Everything the server does that opens a connection to an address somebody else
chose goes through one guard (`packages/scripts/src/net-guard.ts`). This page
says what the guard refuses, who can allow what, and lists every place the
server makes such a connection and what proves it is guarded.

## What the guard does

- **Checks the address that is connected to.** A name is resolved once, by the
  socket's own lookup; every address it gives is judged, and the connection goes
  to one of those. A name that answers differently the next time cannot move a
  request that was already allowed.
- **Never reaches link-local or metadata addresses** (169.254.0.0/16 and
  fe80::/10, where clouds keep instance credentials; 100.100.100.200;
  168.63.129.16; `metadata.google.internal` and the other metadata names), the
  unspecified address (0.0.0.0, `::`), or multicast and reserved ranges. No
  setting allows these. IPv6 zone identifiers and deprecated site-local scoped
  addresses are also refused, including in DNS answers and allow lists with
  zone identifiers.
- **Reaches the machine's own network only where allowed:** loopback,
  10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, fc00::/7 and the
  other ranges used inside a network. A destination an administrator typed in
  (a webhook, an identity provider, an S3 endpoint, an AI endpoint, a mail
  server) may be on the own network. A destination a *script* chooses may not,
  unless it is listed (below).
- **Reads addresses the way the URL parser does.** `http://0x7f.1/`,
  `http://2130706433/`, `http://017700000001/` and `http://[::ffff:7f00:1]/`
  are 127.0.0.1; IPv4-mapped, NAT64, 6to4 and IPv4-compatible IPv6 forms are
  judged by the IPv4 address inside them.
- **Follows redirects by hand,** at most five, each hop checked again. A hop to
  another origin carries none of the request's headers except Accept, Accept-Language,
  Accept-Encoding, User-Agent and Range, so no credential follows it. A POST
  turned into a GET sends no body.
- **Caps time and size.** A request has the caller's total time and response size
  limits (size counted after gzip, x-gzip, deflate or Brotli decompression).
  The deadline also cancels a stalled streaming upload before admission.
  Bodyless responses close their sockets immediately instead of draining
  unsolicited payloads; HTTP protocol upgrades are refused. Script requests also obey
  `TABULARIUS_OUTBOUND_MAX_TIME_MS` (default 10 minutes), including time waiting
  for capacity. Operator requests, such as S3 transfers and standby copies, keep
  their own timeouts, including `Infinity`.
- **Bounds script capacity and slow transfers.** Scripts share eight active
  HTTP/HTTPS requests per initiating file and four per initiating account.
  Ordinary script responses must sustain 1024 bytes/second in each 15-second
  window. Event streams (`text/event-stream`) and operator requests are exempt
  from this rate rule. Operator work started by a script's commit, including
  change-feed subscribers and webhooks, inherits neither its slots nor its stop
  signal.
- **Isolates request state.** Each HTTP/HTTPS request, including each redirect,
  gets a fresh socket and agent. There is no shared cookie jar, authorization
  state or TLS session cache across requests, accounts or files. Admission is
  counted by file/account, not hostname, so additional destination names cannot
  create additional active capacity.
- **Ignores proxy environment variables.** `HTTP_PROXY`, `HTTPS_PROXY`,
  `ALL_PROXY`, `NO_PROXY`, their lowercase forms and `NODE_USE_ENV_PROXY` do not
  route guarded requests through a proxy.
- **Keeps resolved destinations out of failure messages.** Guard refusals and
  connection/DNS/TLS failure causes omit host names and addresses. System error
  codes remain available for diagnostics. Malformed request and redirect URLs
  produce generic errors without echoing the URL. Caller-provided abort reasons
  are preserved.
- **Refuses credentials in the address** (`http://user:pass@host/`) and any
  scheme but http and https.

## What an administrator can allow

By default a script's request to the own network is refused. `tabularius serve`
takes `--allow-script-network-to` with a comma-separated list of the hosts and
ranges scripts may reach there:

<!-- docs-example: illustrative -->
```sh
tabularius serve <folder> --allow-script-network --allow-script-network-to intranet.example,*.corp.example,10.8.0.0/16,192.168.1.20
```

An entry is a host name (`intranet.example`), a wildcard (`*.corp.example`, not
`corp.example` itself), an address, or a range in CIDR form. A listed name is
allowed at whatever own-network address it resolves to; a listed address or range
is allowed whatever name led to it. The list changes nothing for link-local and
metadata addresses. In outbound test mode the allowed hosts are allowed too.

This is a change from earlier versions, where `--allow-script-network` let a
script reach any address, loopback and the metadata range included. Scripts that
call a service on the own network now need that service listed.

`--allow-script-network` itself still decides whether scripts reach the network at
all: it is off by default, and never on for scripts an AI app runs.

## Every place the server connects out

| Where | Destination chosen by | Guarded how | Tests |
| --- | --- | --- | --- |
| Insert from URL and cURL options (scripts) | a script | `guardedFetch`, own network only for listed hosts | `insert-from-url-guard`, `net-guard` |
| `connection://` addresses (scripts) | a connection an administrator set up (with `--allow-app-connections`, finished by a Full Access account) | the connection's own guarded fetch: the own network is allowed whatever `--allow-script-network-to` says, and the path stays on the connection's address | `connections-*` |
| Plug-in web requests | a plug-in's manifest and a script | the same `guardedFetch` as Insert from URL | `plugin-network`, `net-guard` |
| Outbound test mode requests | a script, on the allow list | the same; a host named exactly on the allow list may be on the own network, a `*.` wildcard may not | `outbound`, `outbound-loop` |
| Connections (REST, S3 and their OAuth token exchange) | an administrator | `guardedFetch`, own network allowed, no redirect followed | `connections-*`, `webhook-ssrf` |
| Offsite backup to S3 | an administrator | `guardedFetch`, own network allowed | `s3`, `backup-external` |
| Webhooks | an administrator | `guardedFetch`, own network allowed; link-local refused when created and when sent | `webhook-ssrf` |
| Send Mail (SMTP) | an administrator | the socket's lookup is the guard's; an address written out is checked first | `connections-smtp`, `send-mail-smtp` |
| OIDC discovery, keys, token exchange | an administrator (the provider's own discovery document names the rest) | `guardedFetch`, 15 s and 2 MB limits | `oidc`, `oidc-multi`, `oauth-oidc` |
| LDAP sign-in | an administrator | the socket's lookup is the guard's | `ldap`, `ldap-scim-signin` |
| AI provider (`api.anthropic.com`) | an administrator | `guardedFetch` | `ai-access`, `ai-replace` |
| Embedding endpoint | an administrator | `guardedFetch` | `embed-endpoint` |
| Image embedding (Voyage, Jina) | fixed public hosts | not routed: no part of the address is chosen by anyone | `image-embed` |
| Certificate authority (ACME) | an administrator | `guardedFetch` | `acme` |
| Standby following a primary | an administrator | `guardedFetch`, own network allowed | `standby` |
| Sync with FileMaker Server, and its migration read | an administrator; sync also refuses this machine unless `TABULARIUS_SYNC_HOSTS` lists it | the request's lookup is the guard's | `fms-sync*`, `fms-migrate`, `sync-console` |
| Worker proxy in a cluster | none (a unix socket path) | not a network address | `cluster` |
| The command line asking the local server; the service health check | this machine's own access file | not routed: it is the machine itself | `service` |
| The JavaScript sandbox | none: it refuses every connection | `store/src/javascript.ts` replaces the connect functions with a refusal | `javascript-functions` |

`outbound-guard-drift.test.ts` scans the source of every package except the web
client, and fails when a raw `fetch`, `http(s).request`, `net`/`tls` connect,
WebSocket, HTTP/2 or datagram socket appears outside the guard without an entry
and a reason in its list. An entry that says its connections use the guard's
lookup is also checked for that.

## Known gaps

- A discovered OIDC endpoint (`token_endpoint`, `jwks_uri`) is trusted as far as
  the provider an administrator chose: it is reached under the same policy as the
  provider, including the own network.
- Image embedding sends to two fixed public hosts through the global fetch, so
  the guard's time and size limits do not apply to it.
- Unknown or compound `Content-Encoding` values are returned as opaque bytes
  with their encoding header preserved. Their byte cap applies to those bytes;
  the guard does not promise a decoded-size cap for an encoding it does not decode.
- `fms-sync` and `fms-migrate` build their own requests (cookie handling and a
  response cap of their own); only the connection's lookup is the guard's.
