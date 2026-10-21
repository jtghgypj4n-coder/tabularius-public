---
id: script-step-225
title: "Save Records as JSONL"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Save Records as JSONL

Save Records as JSONL is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 225

## What the engine does

The engine has a handler for this step. Its effect depends on the named target and current script context.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `With dialog:`, `Create folders:`, `Format for fine-tuning:`, `Completion Field:`, `Table:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `100`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Save Records as JSONL
```

**Expected end state:** The step returns error `100`; the original record remains. No external action is attempted.
