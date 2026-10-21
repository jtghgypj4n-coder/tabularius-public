---
id: script-step-13
title: "Insert Current Date"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Insert Current Date

Insert Current Date is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 13

## What the engine does

The engine handles this step with the limits described in the support notes.
Inserts at the current selection in the active field when no target is given; explicit field and `$variable` targets are supported. User Name uses AccountName.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Script text accepts `Select`; where the step runs, this selects the whole target. `Select: Off` preserves the current selection where supported.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `102`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Insert Current Date
```

**Expected end state:** The step returns error `102`; the original record remains. No external action is attempted.
