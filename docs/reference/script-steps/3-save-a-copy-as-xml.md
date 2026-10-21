---
id: script-step-3
title: "Save a Copy as XML"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Save a Copy as XML

Save a Copy as XML is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 3

## What the engine does

The engine has a handler for this step. Its effect depends on the named target and current script context.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Destination:`, `Create folders:`.

## Privileges

Full access to the file, or a script configured to run with full access.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `9`, `100`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Save a Copy as XML
```

**Expected end state:** The step returns error `100`; the original record remains. No external action is attempted.
