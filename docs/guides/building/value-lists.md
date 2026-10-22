# Add a value list

Use this guide when a field should offer a controlled set of choices. It covers a static value list and connecting it to a field control in a layout.

1. Decide whether the choices are fixed or should come from records. Keep the stored values stable even if their labels change.
2. In **Design → Value Lists**, create a list and enter one value per choice, or configure its source fields.
3. Select the field on the layout and choose a pop-up, drop-down, radio button or checkbox control that uses the list.
4. Save and test an existing value, a new choice, and the behavior when a record contains a value no longer on the list.

## Worked example

This adds an invented status list with three values to the starter database. It creates metadata only; connect the list to a field control in the layout editor to use it in the browser.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createValueList","name":"Build task status","values":["Open","In progress","Done"]}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Confirm all three values appear in the design and in the field control's list picker.
- Try the control in Browse mode and confirm the intended value is stored.
- Review [value-list support in the web client](../../web-client.md) when converting an existing file.

See [Design mode](../../design-mode.md), [web client coverage](../../web-client.md), the [REST reference](../../reference/rest.md), and [known differences](../../known-differences.md). The example's list is native Tabularius design data; it makes no claim about undocumented FileMaker sorting or value-list behavior.
