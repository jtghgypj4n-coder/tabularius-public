---
id: script-step-43
title: "Print"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Print

Print is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 43

## What the engine does

The engine handles this step with the limits described in the support notes.
Requests client printing. Save Records as PDF uses the stored file paper size, orientation and fixed margins, but ignores Page Setup scale.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Print privilege for the target file.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `9`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Print
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
