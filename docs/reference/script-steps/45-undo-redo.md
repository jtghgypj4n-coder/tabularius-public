---
id: script-step-45
title: "Undo/Redo"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Undo/Redo

Undo/Redo is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 45

## What the engine does

The engine handles this step with the limits described in the support notes.
Undo puts back the field the last uncommitted edit in the current record changed, Redo makes an undone edit again, Toggle does whichever didn't happen last. It covers the edits the script made since the record was last committed or reverted; the person's own typing before the script started isn't known to it. With nothing to undo it does nothing (inferred). In a converted .fmp12 file the choice is read as the dialog lists it (1 Undo, 2 Redo, 3 Toggle), inferred because no sample file has the step.

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
Undo/Redo
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
