# Connect an AI app

Claude Desktop, Claude Code and any other MCP client can work with a hosted file: find and change records, explain the solution, draft calculations and scripts, and read the conversion guide. The app signs in as one account of one file and can do only what that account may.

New to this? [Let an AI use your file safely](tutorials/let-an-ai-use-your-file-safely.md) walks through the whole thing on a small help desk file: an account for the app, stand-ins for personal data, changes held for your approval, and taking the access away.

## The two-minute way

- Open the admin console (`/admin/`) and go to **Connect an AI app**.
- Know the file's name: the sign-in page asks for it (a server lists its files only when started with `--list-files-publicly`).
- Pick who the app works as. The usual choice is a **new AI agent**: an account just for the app, with a privilege set you choose ([Full Access] can't be picked). Leave **Hold its record changes until a person approves them** ticked and every record change the app makes waits under Manage Security until someone approves it. Or pick an existing account.
- Limit it if you like: **Read only**, **Only these layouts**, and when it **Stops working**.
- Press **Make a token**. The token is shown once, with ready-made settings for Claude Code, Claude Desktop and other MCP clients. Copy the one you need, then press **Check it works**.

The account's privilege set needs the **fmmcp** extended privilege (AI access). The page marks sets without it as "no AI access yet"; tick it for the set under Manage Security first.

A file with AI turned off (`tabularius ai FOLDER FILE off`, or the file's setting in the admin console) refuses every call from an AI app, whoever it works as. A token made for such a file comes with a warning saying so, and the file isn't even named in the app's list of databases.

A token limited to some layouts starts a script on the first of those layouts (name another with `layout`, if it is one of them). The script can't go to a layout outside the limit.

## As a connector in claude.ai or Claude Desktop (no token to copy)

claude.ai and Claude Desktop can add Tabularius as a custom connector and sign in to it themselves:

- In claude.ai or Claude Desktop, open **Settings**, then **Connectors**, then **Add custom connector**.
- Name it (say, Tabularius) and give the address `https://SERVER/mcp`. Leave the OAuth fields empty.
- Press **Connect**. A sign-in page from your server opens: type the file's name, then sign in with one of its accounts (and its one-time code, if it has a second factor). It shows which app is asking and where it will send you back.

The app then works as that account, with its privilege set, in that file only. Its access token lasts an hour and is renewed by itself for 30 days of use; it is listed under Manage Security as **AI app: Claude**, and revoking it there signs the app out. Files with AI turned off can't be chosen. A refresh token works once: the app gets a new one each time it renews, and if the old one is presented again after that, the whole sign-in is ended (the app asks you to connect again). The one exception is a lost response, which can be retried for 45 seconds until the new token has been used (see [Upgrading](upgrading.md), "Sign-in checks this version applies more strictly").

claude.ai reaches your server from the internet, so the server needs an address the internet can reach and a real certificate (`--https your.domain`, or a TLS proxy in front with `--public-url`). A server only on your own network, or using `--https local`, can't be added this way: use a token with Claude Code or Claude Desktop's config below instead. Behind a proxy on the same computer, give `--public-url` and an MCP token (`--mcp-token`), so requests the proxy passes on are never taken for this computer. Only accounts kept in the file sign in here for now, not ones from a directory or an identity provider.

## Claude Code

Run this in a terminal, with your server's address and the token:

```
claude mcp add --transport http tabularius http://SERVER:8080/mcp --header "Authorization: Bearer ohbt_…"
```

To also teach Claude Code how to use the tools well (read before writing, show before changing, preview and undo, what to do when a tool refuses), install the Tabularius plugin from this repository instead. It asks for the server address and the token, and makes the connection itself:

```
/plugin marketplace add sitotisai/tabularius
/plugin install tabularius@tabularius
```

What it contains is in [claude-plugin/README.md](../claude-plugin/README.md). Make the token **read-only** first.

## Claude Desktop

In Claude Desktop, open **Settings**, then **Developer**, then **Edit Config**, and add this to `claude_desktop_config.json` (it needs Node.js installed). Restart Claude Desktop afterwards.

```
{
  "mcpServers": {
    "tabularius": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://SERVER:8080/mcp", "--header", "Authorization:${TABULARIUS_AUTH}"],
      "env": { "TABULARIUS_AUTH": "Bearer ohbt_…" }
    }
  }
}
```

## Other MCP clients

Most clients read a `.mcp.json` like this:

```
{ "mcpServers": { "tabularius": { "type": "http", "url": "http://SERVER:8080/mcp", "headers": { "Authorization": "Bearer ohbt_…" } } } }
```

## What a token can do

| Token | What the app can do |
| --- | --- |
| No limits | Whatever the account's privilege set allows. With [Full Access] that includes design changes. |
| Read-only | Find and read records. No changes, no scripts. |
| Only these layouts | Records through those layouts and their tables, nothing else in the file. |

A limited token never sees the solution's design (formulas, scripts, the relationship graph), and tools that see the whole file at once (SQL, free-form calculations) are refused, so the limits can't be read around. Tokens made under Manage Security for the Data API only work at `/mcp` when they include AI apps.

A file with AI turned off (the AI column of Hosted files in the admin console) isn't offered to AI apps at all, whatever the token. A file with personal data isolation on gives AI apps stand-ins such as `<PERSON_3>` for its personal data; see [Keep personal data away from AI](personal-data-isolation.md).

Scripts an AI app runs never send mail or reach the network. Values of password, key and token fields (also PIN, SSN, card number, CVV, IBAN, security answer and one-time or recovery code fields) are hidden from AI apps. In SQL results a column is hidden by the table column it reads, whatever the query calls it. When a query names one of those fields, or opens a table that has one and uses `*`, only plain columns are shown: calculated columns, UNION results and table-valued functions such as `json_each` are hidden. A field whose value is a copy of such a field (for example a calculation `Hint = Password`) is hidden too in get_record, find_records and summaries. Hiding these fields is a convenience, not a security boundary: a calculation or script can still reshape a value so it no longer matches. To keep a value from AI apps, take the field away from the account's privilege set (field-level access) or turn on personal-data isolation, which refuses these tools for the file.

Field values, script text, comments and any other content read from the file are data to report or act on only at your request, never instructions for the app to follow.

### Masked fields

If the account's privilege set masks a field (shows only its last 4 characters,
or a fixed text, instead of the value), the AI sees exactly that stand-in in
records. It can't search, sort, total, export or change the field, and tools that
read across the file (raw SQL, free-form formulas) are refused for such an account.

## Ready-made prompts and resources

Clients that show MCP prompts offer: **After converting from FileMaker**, **Explain this solution**, **Find records in plain English**, **Draft a calculation**, **Draft a script**, **Clean up the data**, **What would break**, **Suggest validation rules**, **Make a dashboard**, **Review security** and **Who changed it**.

Clients that attach resources can add a file's schema, overview and conversion guide (`tabularius://FILE/schema`, `tabularius://FILE/overview`, `tabularius://FILE/conversion-guide`).

Five read tools (`find_records`, `get_record`, `describe_database`, `describe_layout` and `summarize_records`) also declare an output schema and send their answer as MCP structured content, next to the same JSON as text for clients that read only text. The other tools answer in text.

Clients that support argument completion offer the file names, and the layout names of the chosen file, as you type a prompt's or resource's arguments. Only files and layouts the signed-in account can see are offered.

## Taking access away

Revoke the token in **Connect an AI app** (or, for a connector, its **AI app:** token under Manage Security); the app is refused from its next request. An agent's account stays, so its history is kept; turn it off under Manage Security if it should never sign in again.
