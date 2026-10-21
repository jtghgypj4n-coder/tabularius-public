---
id: script-step-103
title: "Exit Script"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Exit Script

Exit Script is a script flow script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 103

## What the engine does

Ends the script and returns the evaluated result to its caller.
## Options

Supply an optional text result calculation.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Exit Script [ Text Result: "done" ]
```

**Expected end state:** The script result is `done`; no record changes.
