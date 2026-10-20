# Starter solutions

Five small apps you can start from instead of an empty database. Each is built when you create the database, through the same design operations the assistant and design mode use, so you can change every part afterwards.

<!-- docs-example: run -->
```sh
tabularius new ~/tabularius Tasks --starter tasks
tabularius passwd ~/tabularius Tasks Admin
tabularius serve ~/tabularius
```

Add `--no-sample` to start without the sample records. Without it you get a few invented records so the first screen is not empty; each record with a Notes field says "Sample record. Delete me." there. Stock movements and invoice lines have no Notes; they belong to the sample products and invoices and go with them when you delete those. `--starter` works on a new database only; it will not touch an existing one.

| Starter | Tables | Scripts | Report |
| --- | --- | --- | --- |
| `crm` | Companies, Contacts, Deals | Close deal (parameter `Won` or `Lost`), Duplicate deal | Deals by stage |
| `inventory` | Products, Movements | Receive stock, Sell stock (parameter `product id\|quantity\|note`) | Stock value by supplier |
| `invoicing` | Customers, Products, Invoices, Lines | New invoice (parameter: customer ID), Send invoice, Mark as paid | Invoices by status |
| `tasks` | Projects, Tasks | Mark done, Reopen, Duplicate task | Tasks by status |
| `booking` | Resources, Bookings | Book (parameter `resource id\|customer\|day\|start\|end`), Confirm booking, Cancel booking | Hours by status |

What each one has:

- **Tables and relationships.** Every table has a `ID` that numbers itself. A parent table (a company, an invoice, a project) shows its related rows in a portal on its form, and the calculations that add them up (a company's open pipeline, an invoice's total, a project's percent done) follow the relationships.
- **Layouts.** A form named after the table and a "<Table> list" for each table, plus the report. Fields that take one of a few values (a deal's stage, a task's status) are pop-up menus fed by a value list. Where a script is the natural next step, the form has a button for it.
- **Scripts.** They take what they need from the script parameter, check it, and say what happened in the script result. `Book` looks through the existing bookings and refuses a time that overlaps one that is not cancelled. `Sell stock` will not take stock below zero.
- **Privilege sets.** `Staff` can look at, add and change records but not delete, and cannot change the design. `Read only` can look, search and print. Neither can change layouts, value lists or scripts; both can run scripts, and a script cannot do more than the account running it. Make accounts with `tabularius passwd ~/tabularius <database> <account> --privilege-set Staff`, or in the admin console.

## Tested

Every starter is built into a fresh database in the tests, and then used the way this page describes: the scripts run and give the results above, the calculations give the expected totals, `Book` refuses overlaps, and a hosted copy answers every layout through the Data API for a Staff and a Read only account, where Staff can add and edit but not delete and a script run by Read only changes nothing. Each starter also passes [`tabularius check-solution`](check-solution.md) with no errors and no warnings. Names and records are invented.

## Not covered

- There are no screenshots on this page. The layouts are drafted by the same tool the assistant uses, and are checked for consistency (every field, button and label points at something that exists) and served through the Data API, but they have not been rendered in a browser by a test.
- The starters are examples to learn from and adapt, not finished products. Invoicing keeps no tax, currency or numbering rules, and booking knows nothing about opening hours.

The [examples](../examples/README.md) are the same idea as design-text folders you can read and edit as files.
