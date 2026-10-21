---
id: script-step-12
title: "Insert from Last Visited"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Insert from Last Visited

Insert from Last Visited is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 12

## What the engine does

The engine handles this step with the limits described in the support notes.
Sets the whole target field to its value in the record this window's table was on before the current one. A script started from the web client also knows the record the window showed before the one it started on; other runs (schedules, the Data API) know only the records visited during the run. Error 101 when there is none, or it has been deleted or can't be seen.

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
Insert from Last Visited
```

**Expected end state:** The step returns error `102`; the original record remains. No external action is attempted.
