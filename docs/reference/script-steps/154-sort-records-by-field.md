---
id: script-step-154
title: "Sort Records by Field"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Sort Records by Field

Sort Records by Field is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 154

## What the engine does

The engine handles this step with the limits described in the support notes.
Ascending, descending and custom (value list) orders all sort. Sort Records by Field with a custom order uses the value list of the field's object on the layout. Only script text names a Sort Records step's custom-order value list. A step read from a converted .fmp12 (the binary reference isn't decoded) or from pasted XML doesn't carry it yet, so it stops with error 105.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Value list:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `102`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Sort Records by Field
```

**Expected end state:** The step returns error `102`; the original record remains. No external action is attempted.
