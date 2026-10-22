# Create a custom function

Use this guide when a calculation formula is repeated and should have one named definition. It covers a calculation-language custom function and how to check it before using it in a field.

1. Choose a short name and parameters that describe the inputs. Define the result as a calculation that uses only those parameters.
2. Open **Design → Custom Functions** and create the function.
3. Use the formula checker with representative parameter values. Save only after the checker accepts the expression.
4. Use the function in a calculation field, then test both ordinary values and empty or boundary inputs.

## Worked example

This defines `BuildDouble ( value )` as a calculation function. The test data is the literal number `6`; no file data is read.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createCustomFunction","name":"BuildDouble","parameters":["value"],"formula":"value * 2","language":"calculation"}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Confirm `BuildDouble` appears with one parameter in `tabularius schema`.
- Evaluate `BuildDouble ( 6 )` with the design formula checker and confirm it returns `12`.
- Check that a restricted account cannot use the function to expose fields it cannot otherwise read.

See [Design mode](../../design-mode.md), [calculation privileges](../../calculation-privileges.md), the [REST reference](../../reference/rest.md), [plug-in compatibility](../../plugin-compatibility.md), and [known differences](../../known-differences.md). This describes the Tabularius custom function engine; it does not claim parity for FileMaker's custom function editor.
