---
id: script-step-9
title: "Delete Record/Request"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Delete Record/Request

Delete Record/Request is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 9

## What the engine does

Deletes the current record when the account may delete it.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
New Record/Request
Set Field [ Examples::Name ; "Mira" ]
Commit Records/Requests [ With dialog: Off ]
Delete Record/Request [ With dialog: Off ]
Exit Script [ Text Result: Get ( FoundCount ) ]
```

**Expected end state:** The local record is deleted; the script result is `0` and no Examples records remain.
