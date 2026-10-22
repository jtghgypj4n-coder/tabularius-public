# Add a calculation

Use this guide when a value should be derived from fields rather than typed by a person. It covers a stored calculation field in a new table and how to check its result.

1. Identify the input fields and write the result as a calculation before adding it to the design.
2. Create a field with calculation kind and choose its result type. In the web editor, use the formula checker to catch unknown fields and invalid formulas.
3. Save the design, create or edit a record with known inputs, and compare the displayed result with a hand calculation.
4. Check the account's field privileges if the formula reads data users may not see; calculations can have their own privilege implications.

## Worked example

This creates an invented line table whose `LineTotal` is quantity times unit price. The calculator uses the new table occurrence as its context.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createTable","name":"BuildLines","fields":[{"name":"Quantity","type":"number"},{"name":"UnitPrice","type":"number"},{"name":"LineTotal","type":"number","kind":"calculation","calculation":"Quantity * UnitPrice"}]}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Enter quantity `3` and unit price `4`; confirm the calculated value is `12`.
- Change one input and confirm the result updates.
- Run the formula check in Design mode and review [calculation privileges](../../calculation-privileges.md) before exposing a result to restricted accounts.

See [Design mode](../../design-mode.md), [calculation privileges](../../calculation-privileges.md), the [REST reference](../../reference/rest.md) for formula-check routes, and [known differences](../../known-differences.md). This example states Tabularius calculation behavior; it does not assert FileMaker evaluation parity.
