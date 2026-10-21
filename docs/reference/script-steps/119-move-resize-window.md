---
id: script-step-119
title: "Move/Resize Window"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Move/Resize Window

Move/Resize Window is a layouts and windows script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 119

## What the engine does

The engine handles this step with the limits described in the support notes.
As in FileMaker WebDirect ("supported only for cards"), it sizes and places a card window, or another window drawn over the one behind it; a document window fills the browser window and stays as it is. The current window, or one found by name and then by Get ( WindowUUID ), ignoring case; one that isn't open is error 112. A value left empty keeps the window's own; heights and widths under 50 points are 50, and the web client keeps the card inside the browser window. Get ( WindowHeight ), ( WindowWidth ), ( WindowTop ) and ( WindowLeft ) give a card's size and place once New Window or this step gave them. Runs with no browser window (a schedule, the Data API) do nothing with it.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Name:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Move/Resize Window
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
