# CRM

Companies, the people who work there, and the deals you are trying to win, with a report of what is
still open. Three tables, calculations that follow the relationships, value lists and two scripts. It
is a design folder like [first-app](../first-app) and [invoices](../invoices).

| File | What it makes |
| --- | --- |
| `tables/Companies.txt` | Companies with an industry, and `Contacts Count`, `Pipeline` (open deals, in money) and `Won` worked out from their contacts and deals |
| `tables/Contacts.txt` | People at a company: name, role, email, phone and the company's name |
| `tables/Deals.txt` | Deals: the company, a title, an amount, a stage (starts as Lead), when it opened and closed |
| `relationships.txt` | Companies to Contacts and to Deals (new ones can be made, and deleted, from the company) |
| `value-lists/Industry.txt`, `Deal stage.txt` | The values the Industry and Stage fields offer |
| `scripts/Close deal.txt` | Closes the deal you are on: the parameter is `Won` or `Lost`, and the day is filled in. A closed deal is left alone |
| `scripts/Open deals.txt` | The report: a find for every deal at Lead or Proposal (two find requests make an "or"), then a line each as `Acme: Rockets, 5000` under a count |

```sh
tabularius new ~/tabularius CRM
tabularius design-apply ~/tabularius CRM examples/crm          # lists the changes, makes none
tabularius design-apply ~/tabularius CRM examples/crm --apply
tabularius passwd ~/tabularius CRM Admin
```

Add a company, then a few contacts and deals for it, in the web client. The company's `Pipeline`
and `Won` follow its deals. Run `Close deal` with `Won` on a deal and the amounts move from one to
the other; run `Open deals` for the report.

Every table gets a plain layout. To see a company's deals and contacts on its own page, add a portal
of each to the Companies layout in the layout editor.
