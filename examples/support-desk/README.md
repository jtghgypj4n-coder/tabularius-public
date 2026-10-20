# Support desk: a ticket list an AI app triages

A small help desk made from nothing, to try an AI app (Claude Code, Claude Desktop) working in a
file under your rules. One table of tickets, three value lists and one script. It is a design
folder like [first-app](../first-app) and [invoices](../invoices).

| File | What it makes |
| --- | --- |
| `tables/Tickets.txt` | Tickets: subject, message, sender, when it arrived, a status (starts as New), a priority and a category (both empty until triaged), a draft reply, a `Needs Review` mark and `Days Open` |
| `value-lists/Ticket status.txt`, `Ticket priority.txt`, `Ticket category.txt` | The values each field offers |
| `scripts/Close ticket.txt` | Closes the ticket you are on, unless it is marked `Needs Review` |

## Set it up

```sh
tabularius new ~/tabularius Helpdesk
tabularius design-apply ~/tabularius Helpdesk examples/support-desk --apply
tabularius passwd ~/tabularius Helpdesk Admin
```

Add a few tickets in the web client (or ask your AI app to, as a person's request). Then give an AI
app its own account, in the admin console under **Manage Security**:

1. Make a privilege set **Support agent**: view and edit records, no create, no delete, and tick the
   extended privilege **fmmcp** (AI access).
2. Under **Connect an AI app**, pick Helpdesk, a **new AI agent** with that set, and leave
   **Hold its record changes until a person approves them** ticked if you want to approve each change
   yourself. Copy the setting it shows for Claude Code. See [Connect an AI app](../../docs/connect-ai.md).

## Try asking

- "Show me the new tickets." (`find_records`)
- "Put every ticket whose subject starts with Invoice in Billing at High priority. Show me what would
  change first." (`update_records` with `dryRun`, then again with the count it showed)
- "Write a draft reply for the ticket from lee@hooli.example and mark it for review." (`update_record`)
- "Undo that." (`undo_data_fix` with the batch it gave)

What the account's privilege set refuses, the app is refused too: it cannot delete a ticket, and
the **Close ticket** script will not close one marked `Needs Review`. A reply is only ever a draft
in a field; nothing is sent from here.

`packages/server/test/support-desk-example.test.ts` does exactly this over MCP and checks each step.

A step-by-step version, with every command, is the tutorial [Let an AI use your file safely](../../docs/tutorials/let-an-ai-use-your-file-safely.md).
