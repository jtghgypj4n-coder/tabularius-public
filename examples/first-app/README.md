# First app: Contacts

A small contacts book made from nothing: no FileMaker file, no third-party files. It is a design
folder, the same text `tabularius design-text` writes, so you can read every file, change it, and
apply it again.

| File | What it makes |
| --- | --- |
| `tables/Contacts.txt` | A Contacts table: a serial ID, name, email, phone, company, a status, a creation time stamp and a count of calls |
| `tables/Calls.txt` | A Calls table: a serial ID, the contact's ID, a date and a summary |
| `relationships.txt` | One relationship, Contacts to Calls, on the contact's ID, that creates calls from the contact side |
| `value-lists/Contact status.txt` | The values Lead, Customer and Past |
| `custom-functions/Initials.txt` | `Initials ( name )`, the first letter of the first two words |
| `scripts/Make customer.txt` | Marks the current contact as a customer |

From the repository (or wherever you keep this folder):

```sh
tabularius new ~/tabularius Contacts
tabularius design-apply ~/tabularius Contacts examples/first-app          # lists the changes, makes none
tabularius design-apply ~/tabularius Contacts examples/first-app --apply
tabularius passwd ~/tabularius Contacts Admin
```

Each new table gets its own layout, so the file opens in the web client straight away. See
[docs/design-mode.md](../../docs/design-mode.md) to take it further.
