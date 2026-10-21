---
id: script-step-141
title: "Set Variable"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Set Variable

Set Variable is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 141

## What the engine does

Evaluates the value calculation and stores it in a local or session variable.
## Options

Choose a $ variable, a value calculation and, optionally, a repetition. Accepted script-text labels: `Value:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Set Variable [ $count ; Value: 2 + 3 ]
Exit Script [ Text Result: $count ]
```

**Expected end state:** The script result is `5`; no record changes.
