---
id: script-step-223
title: "Set Revert Transaction on Error"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Set Revert Transaction on Error

Set Revert Transaction on Error is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 223

## What the engine does

The engine handles this step with the limits described in the support notes.
Explicit On/Off works. An unspecified or undecoded imported state returns error 3 and leaves the existing setting unchanged.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Set Revert Transaction on Error
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
