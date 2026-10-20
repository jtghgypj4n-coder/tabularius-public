# Inventory

Stock kept as a ledger of movements, a status that follows it, and a script that mails suppliers when
something runs low. Two tables, calculations that follow the relationship, and three scripts. It is a design
folder, the text `tabularius design-text` writes.

| File | What it makes |
| --- | --- |
| `tables/Products.txt` | Products with a SKU, a supplier email and a reorder level, and `On Hand` and `Status` ("Reorder" at or below the level, else "OK") worked out from their movements |
| `tables/Movements.txt` | The ledger: the product, the day (today unless you say), a `Change` (plus for stock in, minus for stock out) and a note |
| `relationships.txt` | Products to Movements (new movements can be made, and deleted, from the product) |
| `scripts/Receive stock.txt` | Adds stock from a parameter like `1\|24\|Delivery 7` (product, quantity, note) |
| `scripts/Sell stock.txt` | Takes stock out from `1\|3`, and refuses to take out more than is on hand (`only 5 on hand`) |
| `scripts/Reorder alerts.txt` | Sends one mail per product whose status is Reorder, to its supplier email; products with no supplier email are skipped |

Stock is never typed in: `On Hand` is the sum of the product's movements, so the ledger shows how a number came to be.

```sh
tabularius new ~/tabularius Stock
tabularius design-apply ~/tabularius Stock examples/inventory          # lists the changes, makes none
tabularius design-apply ~/tabularius Stock examples/inventory --apply
tabularius passwd ~/tabularius Stock Admin
```

Make a few products with a reorder level, run `Receive stock` and `Sell stock`, and watch `Status` change.

## Running the reorder script on a schedule

In the admin console, add a script schedule for `Reorder alerts` (for example every 1440 minutes from 08:00 for a
morning run). Scheduled scripts are offline: they send no mail until you have done both of these.

1. Add an email connection on the Connections page, marked "Send Mail steps use it", and press Test.
2. Turn the schedule's network switch on. That records your approval of the scripts as they stand; if anyone changes them
   later, the schedule keeps running without connections until you approve again (see Connections in the main README).

Until then the script runs, but its mails are not sent. To see what it would send without sending anything, run it in
outbound test mode: the messages are written to the outbox and go nowhere. The example's test does exactly that, so it
needs no mail account and no network.
