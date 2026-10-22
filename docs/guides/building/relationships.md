# Relate tables

Use this guide when a solution needs records in one table to refer to records in another, such as a customer and that customer's orders. It covers matching fields and checking the relationship graph in Design mode.

1. Decide which table owns each record and add a matching key field to each table. Use the same compatible type on both sides.
2. Open **Design → Relationships** and add the table occurrences you need to the graph.
3. Drag the parent key onto the corresponding foreign key, or create the relationship in the design editor. Review the match direction and whether related records may be created or deleted through the relationship.
4. Save, then inspect **About this graph** for missing fields, unused occurrences or duplicate paths.
5. Add a portal to the parent layout if people need to see or create its related rows.

## Worked example

This makes synthetic customer and order tables, then relates `ID` to `CustomerID`. The relationship does not import or copy any records.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createTable","name":"BuildCustomers","fields":[{"name":"ID","type":"number"},{"name":"Name","type":"text"}]},{"op":"createTable","name":"BuildOrders","fields":[{"name":"CustomerID","type":"number"},{"name":"Amount","type":"number"}]},{"op":"createRelationship","left":"BuildCustomers","right":"BuildOrders","predicates":[{"left":"ID","right":"CustomerID"}]}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Create two customers and orders with matching and non-matching keys; check only matching rows appear through the relationship.
- Confirm the graph's relationship uses the intended fields and that no unintended create/delete option is enabled.
- Check the parent layout's portal after saving and reopening it.

See [Design mode](../../design-mode.md), [solution patterns](../../solution-patterns.md), the [REST reference](../../reference/rest.md), and [known differences](../../known-differences.md). For FileMaker-specific relationship rules, compare with the [Claris relationships overview](https://help.claris.com/en/pro-help/content/relationships.html); the example only demonstrates the Tabularius design API.
