---
id: script-step-180
title: "Refresh Portal"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Refresh Portal

Refresh Portal is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 180

## What the engine does

The engine handles this step with the limits described in the support notes.
Clears the read cache and asks the web client to refresh the portal; error 116 for a missing object.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `116`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Refresh Portal [ Object Name: "Missing" ]
Exit Script [ Text Result: Get ( LastError ) ]
```

**Expected end state:** On a layout with no object named `Missing`, the step returns error `116` and the records are unchanged; the script result is `116`.
