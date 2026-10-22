# Build a layout for the web client

Use this guide when people need a browser screen for viewing or editing a table. It covers creating a layout, placing fields and checking the result in Browse mode.

1. Open the solution in the web client and choose **Design → Layouts**.
2. Create a layout for the table occurrence that owns the screen. Choose a form for one record or a list for scanning multiple records.
3. Add the fields people need, arrange them in reading order and give each input a clear label. Add a portal only when related rows are part of the task.
4. Save the layout and return to Browse mode. Test it with a non-sensitive record and with the privilege set that will use it.

## Worked example

Creating a table through the design API also creates its default occurrence and layout. This runnable example adds a simple screen for synthetic `BuildContacts` records.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createTable","name":"BuildContacts","fields":[{"name":"Name","type":"text"},{"name":"Email","type":"text"}]}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Open the generated layout and confirm both fields are present and editable as intended.
- Try the layout at a narrow browser width and check that controls remain reachable.
- Sign in with the intended privilege set and confirm the layout and fields are available to that account.

See [Design mode](../../design-mode.md), [web client coverage](../../web-client.md), the [REST reference](../../reference/rest.md), and [known differences](../../known-differences.md). Browser layout behavior described here is Tabularius behavior; FileMaker layout parity is tracked in the linked coverage page.
