# Threat model

One page: what Tabularius is built to defend, against whom, and what it does not try to. [Security defaults](security-defaults.md) is the setting-by-setting list that a test holds to the running program; this page is the reasoning behind it.

## What is protected

- **The records in the hosted files**, and who may read or change each field, layout, script and file, as the file's accounts and privilege sets say.
- **The accounts**: passwords (stored as scrypt hashes), second factors, API tokens, passkeys and recovery codes, and the sessions that come from them.
- **The administrator's powers**: the admin console, the Admin API, and `/mcp` with administrator rights.
- **The server's reach**: what a script, a webhook, an AI request or a plug-in may connect to or run.
- **The files and backups as they sit on disk**, to the extent the operating system's permissions on the data folder (and encryption at rest, when turned on) protect them.

## Who the attacker is

| Attacker | Starting point | What the design does |
| --- | --- | --- |
| A stranger on the network | Can reach the port, has no account | Every Data API, web client and SQL route needs an account; the file list is hidden; wrong passwords lock the account and the address; the console and `/mcp` answer only a request that comes straight from this computer, or one that signs in. Without HTTPS a stranger on the path can read passwords: the server says so at start when it listens beyond this computer over plain HTTP |
| A signed-in person with a small privilege set | Has an account | Every route, including SQL, OData and the AI tools, is held to that account's privilege set; the AI-visible policy keeps secret-named fields from the assistant. See [personal data isolation](personal-data-isolation.md) and the [privilege matrix](audit-privilege-matrix.md) |
| A web page in a signed-in person's browser | Can make the browser send requests | The admin console's cookies are `HttpOnly` and `SameSite=Strict`, and a change to the console also needs a header (`x-tabularius-admin`) that a page on another site cannot send; the Data API uses tokens, not cookies, and sends no cross-origin permission; `/mcp` refuses a browser origin; pages cannot be framed. The OAuth endpoints (`/oauth/*`) answer any origin by design. Web client tokens are kept in the page's session storage, so a script injected into the web client could read them; stored scripts in file data have not been audited as an attack here |
| A program that sends crafted requests | Reaches a route with a signed-in or anonymous caller | Body and time limits; every outbound address a request can make a script choose goes through one guard ([outbound requests](outbound-requests.md)); uploads are authenticated ([upload audit](security-upload-auth-audit.md)) |
| Whoever the model reads about | Text inside a record that tries to instruct the AI assistant | The assistant acts with the signed-in person's privileges and no more, and cannot change its own visibility policy: those exceptions are for a person ([AI-visible policy](ai-visible-policy.md)). The exception is `/mcp` from a program on this computer with no token: it acts as the administrator (see "Another person on the same computer"), so text read through it reaches administrator powers |
| A hostile file someone drops in for conversion | A `.fmp12` file placed in the hosted folder or uploaded | **Not audited as an attacker yet.** The converter reads the file's bytes in the server process; whether a crafted file can harm it is a gap, listed under [Not covered](security-defaults.md#not-covered) |
| Someone who gets a backup or a copy of the files | Has the bytes, not the server | Passwords are hashes; backups carry checksums; encrypted backups and encryption at rest are available and **off by default** |
| Another person on the same computer | Can run programs as another user | **Only partly defended.** The console and `/mcp` trust a request that comes from this computer. Put a password on the console and a token on `/mcp` on a shared machine. See the first two "Owner decisions" in the defaults page |

## What it relies on

- The operating system keeps the data folder to the user Tabularius runs as.
- Either the network is trusted or the server speaks HTTPS (its own certificate, Let's Encrypt, or a proxy that says so with `--public-url`).
- The administrator chooses sensible passwords. Nothing enforces a minimum length by default.
- A proxy in front of the server is told about with `--trusted-proxies` and nothing else; forwarding headers from anywhere else are not believed.

## Out of scope

- **A hostile server operator or administrator.** They can read every file, every backup, the keys in the environment and every password as it is typed. Encryption at rest keeps a stolen disk out; it does not keep the operator out.
- **A compromised browser or computer.** Whatever the signed-in person can do, malware on their machine can do.
- **Plug-ins an administrator installs.** A plug-in runs with the permissions its manifest asks for and the administrator approved; a malicious one that was approved is the administrator's decision. The bundled BaseElements-compatible functions are built in and run in the sandbox ([plug-in compatibility](plugin-compatibility.md), [writing a plug-in](writing-a-plugin.md)).
- **Denial of service by someone who is signed in.** Request time and body size are capped, but a signed-in person with many requests can slow a small server.
- **Exposing the server to the internet beyond a proxy that does HTTPS.** [The remote connector plan](remote-connector-exposure.md) says what has to be public for claude.ai and nothing more; a live review of an exposed server is a separate piece of work (backlog item r20-07).
- **The model provider.** With the assistant on, what it reads goes to the provider under the provider's terms. [Personal data isolation](personal-data-isolation.md) keeps names, addresses and the like from reaching the model, per file.

## How this is kept true

- `packages/server/test/defaults.test.ts` starts a server with no flags and holds every row of the defaults table to what it does; the page is made from the table, so a changed default fails the test until the page says so.
- Each attacker row above has audits or tests behind it, linked from the row. Where a row has a gap, it is named in [Owner decisions](security-defaults.md#owner-decisions), not left out.
