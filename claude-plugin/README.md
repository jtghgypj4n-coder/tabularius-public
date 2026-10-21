# Tabularius plugin for Claude Code

Teaches Claude Code to work with a hosted Tabularius solution through its `/mcp` tools: find and change records, import, run scripts, understand a solution, and change layouts and design, safely and inside the account's privileges.

## Install

```
/plugin marketplace add sitotisai/tabularius
/plugin install tabularius@tabularius
```

Claude Code asks for two settings:

- **Server address**, for example `http://localhost:8080` (without `/mcp`).
- **Access token**, from the admin console's **Connect an AI app** (it starts with `ohbt_`). Make the first one **read-only**, and widen it later if you need to.

Without the plugin, the same connection is one command (see [docs/connect-ai.md](../docs/connect-ai.md)):

```
claude mcp add --transport http tabularius http://SERVER:8080/mcp --header "Authorization: Bearer ohbt_…"
```

## What is in it

- `.mcp.json`: the connection, filled from the two settings.
- `skills/tabularius`: safe defaults (read first, show before changing, preview and undo), recipes for the common jobs, and what to do when a tool refuses.
