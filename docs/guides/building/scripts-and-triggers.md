# Add a script and a trigger

Use this guide when a repeatable task should run from a button or a supported event. It covers creating a small script and attaching it only after the script's effect is clear.

1. Write down the task and its expected end state. Keep the first script small enough to test on a disposable record.
2. Open **Design → Scripts** and add the steps in order. Use **Check script** to catch invalid references and unsupported steps.
3. Run the script manually from the debugger or a button and verify its result before adding a trigger.
4. In the layout or trigger settings, choose the event that matches the task. Avoid triggers that write data on every keystroke unless that is necessary.
5. Test both the normal path and a cancelled or invalid input path.

## Worked example

This adds a script that calculates a fixed label and returns it. It is synthetic and safe to run; it does not send mail or make a network request.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createScript","name":"Build example status","text":"Set Variable [ $status ; Value: 42 ]\nExit Script [ Text Result: $status ]"}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Confirm the script appears in `tabularius schema` and in the Scripts list.
- Run it manually and check that the result is `42` before attaching it to a trigger.
- Check the trigger's cancellation and privilege behavior with the intended account.

See [Design mode](../../design-mode.md), [script-step support](../../script-steps-support.md), the [REST reference](../../reference/rest.md) for script design and run routes, [script error codes](../../error-codes.md), and [known differences](../../known-differences.md). Trigger behavior beyond the tested Tabularius paths should be treated as unverified unless a Claris page or a FileMaker run confirms it. <!-- known-difference: Scripts and script steps ;; Trigger behaviour beyond the paths tested here is unverified against FileMaker ;; A trigger may fire in a different order or case than FileMaker ;; A Claris page or a FileMaker run that confirms the trigger behaviour -->
