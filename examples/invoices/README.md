# Invoices

A small invoicing app made from nothing, a step up from [first-app](../first-app): four related
tables, calculations that follow the relationships, and two scripts. It is a design folder, the
text `tabularius design-text` writes, so every file can be read and changed.

| File | What it makes |
| --- | --- |
| `tables/Customers.txt` | Customers, with `Invoice Count` and `Total Billed` worked out from their invoices |
| `tables/Invoices.txt` | Invoices: a serial ID, the customer (`Customer ID`, and `Customer Name` read through the relationship), the issue date, a due date 30 days later, a status, the total of the lines and `Overdue` |
| `tables/Lines.txt` | Lines: the product, quantity (1 unless you say otherwise), unit price and `Line Total` |
| `tables/Products.txt` | Products with a name and a price |
| `relationships.txt` | Customers to Invoices, Invoices to Lines (new lines can be made, and deleted, from the invoice) and Lines to Products |
| `value-lists/Invoice status.txt` | Draft, Sent, Paid, Void |
| `custom-functions/Money.txt` | `Money ( amount )`, an amount as text rounded to cents |
| `scripts/Send invoice.txt` | Moves a draft to Sent, but not while it has nothing to bill |
| `scripts/Mark as paid.txt` | Marks the invoice as paid, unless it is void or already paid |

Calculations that look at related records (`Total`, `Total Billed`, `Customer Name`) are
*unstored*, so they follow the lines as they change. The `Options` line says so on each of them.

```sh
tabularius new ~/tabularius Invoices
tabularius design-apply ~/tabularius Invoices examples/invoices          # lists the changes, makes none
tabularius design-apply ~/tabularius Invoices examples/invoices --apply
tabularius passwd ~/tabularius Invoices Admin
```

Each table gets its own layout. Give a new invoice a `Customer ID` and add lines with a product
and unit price: the invoice's `Total` and the customer's `Total Billed` follow. Try changing the
due date to 14 days (`Issued + 14`) in `tables/Invoices.txt` and run `design-apply` again to see
only that field change.
