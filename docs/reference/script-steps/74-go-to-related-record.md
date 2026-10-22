---
id: script-step-74
title: "Go to Related Record"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Go to Related Record

Go to Related Record is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 74

## What the engine does

The engine handles this step with the limits described in the support notes.
Replaces the found set with related IDs. The binary decoder does not read "Match all records in current found set" or "Show only related records" (their bits are unverified), so a step from a converted file goes from the current record alone; the conversion guide counts those steps and a run adds a warning once per script. Written in script text, "Match all records in the found set" works. "Show only related records" turned off is not supported (the step always replaces the found set).

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `From table:`, `Using layout:`, `New window:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `101`, `401`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Go to Related Record
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
