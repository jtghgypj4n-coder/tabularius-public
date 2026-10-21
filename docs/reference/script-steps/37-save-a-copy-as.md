---
id: script-step-37
title: "Save a Copy as"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Save a Copy as

Save a Copy as is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 37

## What the engine does

The engine has a handler for this step. Its effect depends on the named target and current script context.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Create folders:`.

## Privileges

Full access to the file, or a script configured to run with full access.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `9`, `100`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Save a Copy as
```

**Expected end state:** The step returns error `100`; the original record remains. No external action is attempted.
