# Create a table and its fields

Use this guide when a solution needs a new kind of record, such as a project or task, in a hosted Tabularius database. It covers adding a table with typed fields in Design mode or from the CLI.

1. Open the database in the web client and choose **Design**. The account needs Full Access to change the design.
2. In **Tables & fields**, add a table with a clear singular name. Add one field for each value the record owns; choose a field type that matches how it will be used.
3. Save the design. Tabularius makes a table occurrence and a starter layout for a newly created table unless you turn that option off.
4. Add a record on the new layout and confirm each field accepts the values you expect.

## Worked example

This creates an invented `BuildTasks` table with a title, due date and status field in the starter Invoices database used by the docs example runner.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createTable","name":"BuildTasks","fields":[{"name":"Title","type":"text"},{"name":"Due","type":"date"},{"name":"Status","type":"text"}]}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Open the new table's layout and create a test record; check that the date field and status text field accept the intended values.
- Run `tabularius check-solution ~/Databases Invoices` and resolve any reported design issue.
- Confirm the new table and fields appear in `tabularius schema`.

See [Design mode](../../design-mode.md), [native field types](../../native-field-types.md), the [REST reference](../../reference/rest.md), and [known differences](../../known-differences.md). Field type names in this example describe Tabularius's native design API; they do not claim a FileMaker field-type mapping.
