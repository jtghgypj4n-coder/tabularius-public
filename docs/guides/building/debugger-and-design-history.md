# Debug a script and review design history

Use this guide when a script's result is unexpected or a design change needs review. It covers pausing a script in the debugger and using design history to inspect earlier design changes.

1. Open **Tools → Script Debugger** and choose the script to run. Set a breakpoint on the step you want to inspect.
2. Run the script on a disposable record. Step through the script and inspect variables and the current step before continuing.
3. If the script changes data, verify its end state and use the supported undo path where one is offered; do not assume every script effect can be reversed.
4. In Design mode, open the layout's **Versions** history and compare a saved version with the current layout. **Open this version** makes it unsaved edits; save it only after reviewing the result, or use Undo to drop it.
5. Confirm the final layout and data on the intended screen after the review.

## Worked example

This creates a harmless script with two inspectable variable assignments. Use the debugger to pause between them; it does not modify a record.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createScript","name":"Build debug example","text":"Set Variable [ $count ; Value: 2 ]\nSet Variable [ $double ; Value: $count * 2 ]\nExit Script [ Text Result: $double ]"}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Pause before the second assignment and confirm `$count` is `2`; step once and confirm `$double` is `4`.
- Confirm the script returns `4` when allowed to finish.
- Open the layout's **Versions** history and verify the version preview and change description before opening an earlier version.

See [Design mode and its undo history](../../design-mode.md), [web client coverage](../../web-client.md), the [REST reference](../../reference/rest.md) for debugger routes, [script-step support](../../script-steps-support.md), and [known differences](../../known-differences.md). The debugger and layout-version descriptions here are Tabularius features; they should not be read as claims about FileMaker's debugger or recovery behavior.
