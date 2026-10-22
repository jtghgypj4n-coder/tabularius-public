# Native foreign keys (N4)

A native file (made with `tabularius new --native`) can declare a relationship as a named foreign key: the child field must hold a key that a parent record has, and deleting a parent does what the key's `onDelete` says. Compat files refuse foreign keys and keep their relationships exactly as before.

The relationship stays what it was. Layouts, portals, related fields, lookups and the relationship graph follow it as usual; the foreign key only adds a rule that the store checks on writes.

## Declaring one

A foreign key sits on a relationship whose only match is an equality, child field = parent field. Add it with `createRelationship`, or add, change or drop it with `updateRelationship` (Admin API `POST .../design`, the MCP `change_design` tool, or the design text below):

```json
{ "op": "updateRelationship", "relationship": 3,
  "foreignKey": { "name": "invoice_customer",
                  "child": { "table": "Invoices", "field": "CustomerID" },
                  "parent": { "table": "Customers", "field": "ID" },
                  "onDelete": "cascade" } }
```

- `child` and `parent` name base tables and their fields; they must be the two sides of the relationship's one match, in either order.
- `onDelete` is `restrict` (the default), `cascade`, `set-null` or `no-action`.
- On an update, a `foreignKey` with only some of these keeps the others; `"foreignKey": null` drops it.
- Both fields must be normal stored fields of the same type, not global, repeating or container fields. Both tables must be in this file.
- Names are unique in the file, ignoring case.

Each of these is refused with a message that says why: a relationship with more than one match or a match other than `=`, fields that don't match the relationship, different field types, a compat file. A later change that would break a foreign key is refused too, for example changing the relationship's match, a field's type, or making a field a calculation. Change or drop the foreign key in the same change. Renaming a table or field keeps the key, because it is kept by id. Deleting the child or parent field drops the key with the match. Restoring the field brings both back.

Adding a foreign key, or changing what it checks, first checks the records already there. If any child record has a key that no parent has, or a key of more than one line, the whole change is refused with error 505. The message gives how many records break the key and up to five of their keys.

## What writes must keep

Every record write in the file is checked inside the same transaction as the write: create, edit, duplicate, delete, Truncate Table, and putting a record back from the audit log (the admin console's put-back, `restoreRecord`). A table that is the parent in a foreign key reads, checks and writes under one write lock, so another server process can't add a child in between. Import Records, the web client's import, the Data API, OData, scripts and live sync's pulls all write through these. A refusal is error 505 ("Value is not an existing value in the file"), with a message that names the foreign key. A refused write changes nothing.

- **Child keys.** A child record's key must match a parent record's key. Text is compared without regard to case, as the relationship compares it, and other types are compared as stored. An empty key is allowed. A key with more than one line is refused, because a child holds one parent key. A key that an edit leaves unchanged is not looked up again. In a self-referencing key, a record may name itself.
- **Parent keys.** An edit that changes a parent's key while child records still use the old key is refused. There is no ON UPDATE choice. An edit that leaves another parent with the old key is allowed. Parent keys need not be unique.
- **Deleting a parent.** This applies only when no other parent has the same key:
  - `restrict` refuses the delete before anything is changed, including the relationship's own "delete related records" option.
  - `cascade` deletes the child records. Each one is deleted, audited and announced the way a delete is, and its own foreign keys are followed in turn, so a cascade can go several levels.
  - `set-null` empties the children's key with an ordinary edit, so auto-enter and validation apply. If a field must not be empty, the delete is refused.
  - `no-action` is checked after the delete and everything it does, such as cascades and "delete related records". It refuses only if child records would be left without a parent.
- **Truncate Table** on a parent table treats every child record with a key the same way, by its `onDelete`.

A refusal at any depth undoes the whole delete. Records, audit rows and change events go back to what they were before. Inside a script's open transaction, only the refused write is undone, and the transaction's earlier work stays.

Live sync's "keep related records" setting (`cascade: false`) leaves "delete related records" relationships alone, but foreign keys still apply. Approval-gated AI agents' writes are checked when they are applied.

## Where it shows

- **GetTableDDL**: on the child's occurrence, `CONSTRAINT "name" FOREIGN KEY ("child") REFERENCES "ParentOccurrence" ("parent") ON DELETE CASCADE`. It takes the place of the plain `FOREIGN KEY` line written for that relationship otherwise. Fields the account can't see are left out, as before.
- **Database Design Report**: a `<ForeignKey name="..." onDelete="...">` element inside the `<Relationship>`, with `<ChildField>` and `<ParentField>`. This is Tabularius's own element. A report written by FileMaker Pro has none, so a tool that expects exactly its elements may skip it.
- **Design API and MCP**: `GET /tabularius/design/v1/databases/{db}` and `get_design` list each relationship with its `foreignKey` (side, table and field ids, `onDelete`).
- **Design text** (`relationships.txt`): a line under the relationship. Adding, changing or removing the line in a design folder adds, changes or drops the key when the folder is applied:

  ```text
  Invoices ↔ Customers
    Invoices::CustomerID = Customers::ID
    Options: create in Invoices, create in Customers
    Foreign key "invoice_customer": Invoices::CustomerID references Customers::ID, on delete cascade
  ```

## Not done

- There is no ON UPDATE (cascading a changed parent key to its children). A parent key change while children use it is refused.
- A key across files (a table occurrence of another hosted file) is refused.
- A child write is refused when the parent key is missing even if the account can't see parent records. As in SQL databases, the refusal tells the account that no parent has that key. A refused parent delete or key change gives the number of child records only when the account can view the child table; otherwise it names only the table. These checks read every record, whatever the account may see (the read-gate inventory lists them as internal integrity reads).
- Values are checked one record at a time. Large imports into a child table run one parent lookup per record.
- Export to a compat file does not carry foreign keys. The compat-check registry (N5) is a separate change.
