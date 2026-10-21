---
id: script-step-182
title: "Truncate Table"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Truncate Table

Truncate Table is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 182

## What the engine does

The engine has a handler for this step. Its effect depends on the named target and current script context.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Table:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Truncate Table
```

**Expected end state:** The step returns error `0`; 0 records remain. No external action is attempted.
