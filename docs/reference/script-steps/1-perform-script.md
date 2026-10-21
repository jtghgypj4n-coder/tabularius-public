---
id: script-step-1
title: "Perform Script"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Perform Script

Perform Script is a script flow script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 1

## What the engine does

Runs a named script in the current file, passing the calculated parameter and checking access to the target script.
## Options

Choose a script and an optional parameter calculation.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `104`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Perform Script
```

**Expected end state:** The step returns error `104`; the original record remains. No external action is attempted.
