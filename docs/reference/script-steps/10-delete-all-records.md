---
id: script-step-10
title: "Delete All Records"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Delete All Records

Delete All Records is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 10

## What the engine does

Deletes the records in the current found set when the account may delete them.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Delete All Records
```

**Expected end state:** The step returns error `0`; 0 records remain. No external action is attempted.
