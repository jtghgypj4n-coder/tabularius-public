---
id: script-step-147
title: "Set Field By Name"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Set Field By Name

Set Field By Name is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 147

## What the engine does

The engine has a handler for this step. Its effect depends on the named target and current script context.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `102`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Set Field By Name
```

**Expected end state:** The step returns error `102`; the original record remains. No external action is attempted.
