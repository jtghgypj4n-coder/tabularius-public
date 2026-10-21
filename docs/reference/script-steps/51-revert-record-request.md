---
id: script-step-51
title: "Revert Record/Request"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Revert Record/Request

Revert Record/Request is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 51

## What the engine does

Discards uncommitted edits to the current record.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Revert Record/Request
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
