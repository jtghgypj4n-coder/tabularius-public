---
id: script-step-23
title: "Show All Records"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Show All Records

Show All Records is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 23

## What the engine does

Replaces the current found set with all records visible to the account.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Show All Records
Exit Script [ Text Result: Get ( FoundCount ) ]
```

**Expected end state:** The empty synthetic Examples table remains empty; the script result is `0`.
