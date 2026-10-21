---
id: script-step-89
title: "# (comment)"
area: script-steps
since: unknown
status: not-yet
verified: f200448e0
---

# # (comment)

`# (comment)` is a script flow script step. This page describes how the offline Tabularius engine handles it.

- **Support:** does nothing
- **Registry ID:** 89

## What the engine does

The engine accepts this step but does not perform its named action.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
# An offline note
Exit Script [ Text Result: "done" ]
```

**Expected end state:** The script result is `done`; the comment has no effect.
